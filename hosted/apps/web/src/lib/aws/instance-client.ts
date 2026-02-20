/**
 * Instance Client for OpenClaw Hosted Platform
 * Manages dedicated EC2 instances per user (replaces ECS-based deployment)
 */

import {
  ElasticLoadBalancingV2Client,
  CreateTargetGroupCommand,
  DeleteTargetGroupCommand,
  CreateRuleCommand,
  DeleteRuleCommand,
  DescribeRulesCommand,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import { getEC2PoolManager } from "./ec2-pool";
import type { EC2PoolManager } from "./ec2-pool";

// Configuration from environment
const AWS_REGION = process.env.AWS_REGION || "us-west-2";
const ALB_LISTENER_ARN = process.env.ALB_LISTENER_ARN!;
const VPC_ID = process.env.VPC_ID!;
const DOMAIN_NAME = process.env.OPENCLAW_DOMAIN || "";
const ALB_DNS_NAME = process.env.ALB_DNS_NAME || "";

// HTTP-only mode: no custom domain, use path-based routing
const USE_PATH_ROUTING = !DOMAIN_NAME;

interface CreateInstanceParams {
  userId: string;
  instanceId: string;
}

interface CreateInstanceResult {
  ec2InstanceId: string;
  targetGroupArn: string;
  ruleArn: string;
  url: string;
  gatewayToken: string;
}

interface InstanceStatus {
  status: "pending" | "provisioning" | "running" | "stopped" | "error";
  ec2InstanceId?: string;
  privateIp?: string;
  publicIp?: string;
}

export class InstanceClient {
  private elb: ElasticLoadBalancingV2Client;
  private pool: EC2PoolManager;

  constructor() {
    const config = { region: AWS_REGION };
    this.elb = new ElasticLoadBalancingV2Client(config);
    this.pool = getEC2PoolManager();
  }

  /**
   * Create a new user's OpenClaw instance
   * Container is already running on the EC2 instance (pre-warmed in user_data)
   */
  async createInstance(params: CreateInstanceParams): Promise<CreateInstanceResult> {
    const serviceName = this.getServiceName(params.instanceId);
    const subdomain = params.instanceId.slice(0, 8);

    // URL format depends on whether we have a custom domain
    const url = USE_PATH_ROUTING
      ? `http://${ALB_DNS_NAME}/${subdomain}`
      : `https://${subdomain}.${DOMAIN_NAME}`;

    console.log(`[Instance] Creating instance ${params.instanceId} for user ${params.userId}`);

    let ec2InstanceId = "";
    let targetGroupArn = "";
    let ruleArn = "";
    let gatewayToken = "";

    try {
      // 1. Assign EC2 instance from pool (container already running, get gateway token)
      const assigned = await this.pool.assignToUser({
        userId: params.userId,
        instanceId: params.instanceId,
      });
      ec2InstanceId = assigned.ec2InstanceId;
      gatewayToken = assigned.gatewayToken;
      console.log(`[Instance] Assigned EC2 instance: ${ec2InstanceId}`);

      // 2. Create target group for this user
      targetGroupArn = await this.createTargetGroup(serviceName);
      console.log(`[Instance] Created target group: ${targetGroupArn}`);

      // 3. Register instance with target group
      await this.pool.registerWithTargetGroup(targetGroupArn, ec2InstanceId);

      // 4. Create ALB listener rule for routing
      ruleArn = await this.createListenerRule(serviceName, subdomain, targetGroupArn);
      console.log(`[Instance] Created listener rule: ${ruleArn}`);

      return {
        ec2InstanceId,
        targetGroupArn,
        ruleArn,
        url,
        gatewayToken,
      };
    } catch (error) {
      console.error(`[Instance] Provisioning failed for ${params.instanceId}:`, error);

      // Best-effort cleanup so partial provisioning doesn't leak infrastructure.
      if (ruleArn) {
        await this.deleteListenerRule(ruleArn);
      }
      if (targetGroupArn) {
        await this.deleteTargetGroup(targetGroupArn);
      }
      if (ec2InstanceId) {
        await this.pool.releaseInstance(ec2InstanceId);
      }

      throw error;
    }
  }

  /**
   * Get instance status by EC2 instance ID
   */
  async getInstanceStatus(ec2InstanceId: string): Promise<InstanceStatus> {
    const instance = await this.pool.getInstanceByEC2Id(ec2InstanceId);

    if (!instance) {
      return { status: "stopped" };
    }

    if (instance.status === "initializing") {
      return { status: "provisioning" };
    }

    if (instance.status === "assigned") {
      return {
        status: "running",
        ec2InstanceId: instance.instanceId,
        privateIp: instance.privateIp,
        publicIp: instance.publicIp,
      };
    }

    return { status: "pending" };
  }

  /**
   * Delete user instance
   */
  async deleteInstance(params: {
    instanceId: string;
    ec2InstanceId: string;
    targetGroupArn?: string;
    ruleArn?: string;
  }): Promise<void> {
    const serviceName = this.getServiceName(params.instanceId);

    console.log(`[Instance] Deleting instance ${params.instanceId}`);

    // 1. Get instance info before deletion
    const instance = await this.pool.getInstanceByEC2Id(params.ec2InstanceId);

    // 2. Delete listener rule
    if (params.ruleArn) {
      await this.deleteListenerRule(params.ruleArn);
    } else {
      await this.deleteListenerRuleByServiceName(serviceName);
    }

    // 3. Deregister from target group (if we have the info)
    if (instance?.privateIp && params.targetGroupArn) {
      await this.pool.deregisterFromTargetGroup(params.targetGroupArn, instance.privateIp);
    }

    // 4. Delete target group
    if (params.targetGroupArn) {
      await this.deleteTargetGroup(params.targetGroupArn);
    } else {
      await this.deleteTargetGroupByName(serviceName);
    }

    // 5. Release EC2 instance (terminates it and replenishes pool)
    await this.pool.releaseInstance(params.ec2InstanceId);

    console.log(`[Instance] Instance ${params.instanceId} fully deleted`);
  }

  /**
   * Create a target group for routing traffic to the user's instance
   */
  private async createTargetGroup(serviceName: string): Promise<string> {
    const cmd = new CreateTargetGroupCommand({
      Name: serviceName.slice(0, 32), // Target group name max 32 chars
      Protocol: "HTTP",
      Port: 8080,
      VpcId: VPC_ID,
      TargetType: "ip",
      HealthCheckEnabled: true,
      HealthCheckPath: "/health",
      HealthCheckIntervalSeconds: 30,
      HealthCheckTimeoutSeconds: 5,
      HealthyThresholdCount: 2,
      UnhealthyThresholdCount: 3,
    });

    const result = await this.elb.send(cmd);
    return result.TargetGroups?.[0]?.TargetGroupArn || "";
  }

  /**
   * Delete a target group
   */
  private async deleteTargetGroup(targetGroupArn: string): Promise<void> {
    try {
      await this.elb.send(
        new DeleteTargetGroupCommand({
          TargetGroupArn: targetGroupArn,
        })
      );
      console.log(`[Instance] Deleted target group`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`[Instance] Target group delete error: ${errorMessage}`);
    }
  }

  /**
   * Delete target group by name
   */
  private async deleteTargetGroupByName(_serviceName: string): Promise<void> {
    console.log(`[Instance] Skipping target group deletion by name (no ARN stored)`);
  }

  /**
   * Create an ALB listener rule for routing
   */
  private async createListenerRule(
    serviceName: string,
    subdomain: string,
    targetGroupArn: string
  ): Promise<string> {
    const priority = this.generatePriority(serviceName);

    const conditions = USE_PATH_ROUTING
      ? [
          {
            Field: "path-pattern",
            Values: [`/${subdomain}`, `/${subdomain}/*`],
          },
        ]
      : [
          {
            Field: "host-header",
            Values: [`${subdomain}.${DOMAIN_NAME}`],
          },
        ];

    const cmd = new CreateRuleCommand({
      ListenerArn: ALB_LISTENER_ARN,
      Priority: priority,
      Conditions: conditions,
      Actions: [
        {
          Type: "forward",
          TargetGroupArn: targetGroupArn,
        },
      ],
    });

    const result = await this.elb.send(cmd);
    return result.Rules?.[0]?.RuleArn || "";
  }

  /**
   * Delete a listener rule
   */
  private async deleteListenerRule(ruleArn: string): Promise<void> {
    try {
      await this.elb.send(
        new DeleteRuleCommand({
          RuleArn: ruleArn,
        })
      );
      console.log(`[Instance] Deleted listener rule`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`[Instance] Listener rule delete error: ${errorMessage}`);
    }
  }

  /**
   * Delete listener rule by service name
   */
  private async deleteListenerRuleByServiceName(serviceName: string): Promise<void> {
    try {
      const rulesResult = await this.elb.send(
        new DescribeRulesCommand({
          ListenerArn: ALB_LISTENER_ARN,
        })
      );

      const subdomain = serviceName.replace("openclaw-", "");

      for (const rule of rulesResult.Rules || []) {
        const pathCondition = rule.Conditions?.find((c) => c.Field === "path-pattern");
        if (pathCondition?.Values?.some((v) => v.includes(`/${subdomain}`)) && rule.RuleArn) {
          await this.deleteListenerRule(rule.RuleArn);
          return;
        }

        const hostCondition = rule.Conditions?.find((c) => c.Field === "host-header");
        if (hostCondition?.Values?.includes(`${subdomain}.${DOMAIN_NAME}`) && rule.RuleArn) {
          await this.deleteListenerRule(rule.RuleArn);
          return;
        }
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`[Instance] Listener rule lookup error: ${errorMessage}`);
    }
  }

  /**
   * Generate a deterministic priority from service name
   */
  private generatePriority(serviceName: string): number {
    let hash = 0;
    for (let i = 0; i < serviceName.length; i++) {
      const char = serviceName.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash % 49999) + 1;
  }

  /**
   * Get service name from instance ID
   */
  private getServiceName(instanceId: string): string {
    return `openclaw-${instanceId.slice(0, 8)}`;
  }

  /**
   * Get pool statistics
   */
  async getPoolStats(): Promise<{
    total: number;
    available: number;
    assigned: number;
    initializing: number;
  }> {
    return this.pool.getPoolStats();
  }
}

// Singleton instance
let client: InstanceClient | null = null;

export function getInstanceClient(): InstanceClient {
  if (!client) {
    client = new InstanceClient();
  }
  return client;
}
