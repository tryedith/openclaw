/**
 * AWS ECS Client for OpenClaw Hosted Platform
 * Provisions and manages ECS services for user instances
 */

import {
  ECSClient,
  CreateServiceCommand,
  DeleteServiceCommand,
  DescribeServicesCommand,
  UpdateServiceCommand,
  RegisterTaskDefinitionCommand,
  DeregisterTaskDefinitionCommand,
} from "@aws-sdk/client-ecs";
import {
  ElasticLoadBalancingV2Client,
  CreateTargetGroupCommand,
  DeleteTargetGroupCommand,
  CreateRuleCommand,
  DeleteRuleCommand,
  DescribeRulesCommand,
  ModifyRuleCommand,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import {
  SecretsManagerClient,
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

// Configuration from environment
const AWS_REGION = process.env.AWS_REGION || "us-west-2";
const ECS_CLUSTER = process.env.ECS_CLUSTER_NAME || "openclaw-cluster";
const TASK_DEFINITION = process.env.ECS_TASK_DEFINITION || "openclaw";
const ALB_LISTENER_ARN = process.env.ALB_LISTENER_ARN!;
const VPC_ID = process.env.VPC_ID!;
const SUBNET_IDS = (process.env.SUBNET_IDS || "").split(",").filter(Boolean);
const SECURITY_GROUP_ID = process.env.SECURITY_GROUP_ID!;
const DOMAIN_NAME = process.env.OPENCLAW_DOMAIN || "";
const ALB_DNS_NAME = process.env.ALB_DNS_NAME || "";

// HTTP-only mode: no custom domain, use path-based routing
const USE_PATH_ROUTING = !DOMAIN_NAME;

interface CreateInstanceParams {
  userId: string;
  instanceId: string;
  gatewayToken: string;
  anthropicApiKey: string;
}

interface CreateInstanceResult {
  serviceArn: string;
  targetGroupArn: string;
  ruleArn: string;
  url: string;
}

interface InstanceStatus {
  status: "pending" | "provisioning" | "running" | "stopped" | "error";
  runningCount: number;
  desiredCount: number;
  pendingCount: number;
}

export class ECSClawClient {
  private ecs: ECSClient;
  private elb: ElasticLoadBalancingV2Client;
  private secrets: SecretsManagerClient;

  constructor() {
    const config = { region: AWS_REGION };
    this.ecs = new ECSClient(config);
    this.elb = new ElasticLoadBalancingV2Client(config);
    this.secrets = new SecretsManagerClient(config);
  }

  /**
   * Create a new user's OpenClaw instance
   * This creates:
   * 1. Secret in Secrets Manager with user credentials
   * 2. Target Group for the user's service
   * 3. ALB Listener Rule for subdomain routing
   * 4. ECS Service running the gateway
   */
  async createInstance(params: CreateInstanceParams): Promise<CreateInstanceResult> {
    const serviceName = this.getServiceName(params.instanceId);
    const subdomain = params.instanceId.slice(0, 8);

    // URL format depends on whether we have a custom domain
    const url = USE_PATH_ROUTING
      ? `http://${ALB_DNS_NAME}/${subdomain}`
      : `https://${subdomain}.${DOMAIN_NAME}`;

    console.log(`[ECS] Creating instance ${params.instanceId} for user ${params.userId}`);

    // 1. Create secret for user's credentials
    const secretArn = await this.createUserSecret(params.instanceId, {
      OPENCLAW_GATEWAY_TOKEN: params.gatewayToken,
      ANTHROPIC_API_KEY: params.anthropicApiKey,
    });
    console.log(`[ECS] Created secret: ${secretArn}`);

    // 2. Register user-specific task definition with secrets BEFORE creating service
    // This ensures the service starts with the correct task definition from the beginning
    const userTaskDef = await this.registerUserTaskDefinition(params.instanceId, secretArn);
    console.log(`[ECS] Registered user task definition: ${userTaskDef}`);

    // 3. Create target group for this user
    const targetGroupArn = await this.createTargetGroup(serviceName);
    console.log(`[ECS] Created target group: ${targetGroupArn}`);

    // 4. Create ALB listener rule for subdomain routing
    const ruleArn = await this.createListenerRule(serviceName, subdomain, targetGroupArn);
    console.log(`[ECS] Created listener rule: ${ruleArn}`);

    // 5. Create ECS Service with user-specific task definition (which has secrets)
    const userTaskDefFamily = `openclaw-${params.instanceId.slice(0, 8)}`;
    const createServiceCmd = new CreateServiceCommand({
      cluster: ECS_CLUSTER,
      serviceName,
      taskDefinition: userTaskDefFamily, // Use user-specific task def with secrets
      desiredCount: 1,
      launchType: "EC2",
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: SUBNET_IDS,
          securityGroups: [SECURITY_GROUP_ID],
          assignPublicIp: "DISABLED",
        },
      },
      loadBalancers: [
        {
          targetGroupArn,
          containerName: "gateway",
          containerPort: 8080,
        },
      ],
      // Enable service discovery and health checks
      healthCheckGracePeriodSeconds: 120,
      deploymentConfiguration: {
        minimumHealthyPercent: 0,
        maximumPercent: 100,
      },
    });

    const serviceResult = await this.ecs.send(createServiceCmd);
    const serviceArn = serviceResult.service?.serviceArn || "";
    console.log(`[ECS] Created service: ${serviceArn}`);

    return {
      serviceArn,
      targetGroupArn,
      ruleArn,
      url,
    };
  }

  /**
   * Get instance status
   */
  async getInstanceStatus(serviceNameOrArn: string): Promise<InstanceStatus> {
    const serviceName = serviceNameOrArn.includes(":")
      ? serviceNameOrArn.split("/").pop()!
      : serviceNameOrArn;

    const describeCmd = new DescribeServicesCommand({
      cluster: ECS_CLUSTER,
      services: [serviceName],
    });

    const result = await this.ecs.send(describeCmd);
    const service = result.services?.[0];

    if (!service) {
      return { status: "error", runningCount: 0, desiredCount: 0, pendingCount: 0 };
    }

    const runningCount = service.runningCount || 0;
    const desiredCount = service.desiredCount || 0;
    const pendingCount = service.pendingCount || 0;
    const serviceStatus = service.status;

    let status: InstanceStatus["status"] = "pending";

    if (serviceStatus === "ACTIVE") {
      if (runningCount >= desiredCount && desiredCount > 0) {
        status = "running";
      } else if (runningCount > 0 || pendingCount > 0) {
        status = "provisioning";
      } else if (desiredCount === 0) {
        status = "stopped";
      } else {
        status = "provisioning";
      }
    } else if (serviceStatus === "DRAINING" || serviceStatus === "INACTIVE") {
      status = "stopped";
    }

    // Check for deployment failures
    const deployments = service.deployments || [];
    const failedDeployment = deployments.find(d => d.rolloutState === "FAILED");
    if (failedDeployment) {
      status = "error";
    }

    return { status, runningCount, desiredCount, pendingCount };
  }

  /**
   * Delete user instance
   * This removes:
   * 1. ECS Service
   * 2. User-specific task definition
   * 3. ALB Listener Rule
   * 4. Target Group
   * 5. Secret from Secrets Manager
   */
  async deleteInstance(params: {
    instanceId: string;
    serviceArn?: string;
    targetGroupArn?: string;
    ruleArn?: string;
  }): Promise<void> {
    const serviceName = this.getServiceName(params.instanceId);

    console.log(`[ECS] Deleting instance ${params.instanceId}`);

    try {
      // 1. Scale service to 0 first (allows graceful shutdown)
      await this.ecs.send(new UpdateServiceCommand({
        cluster: ECS_CLUSTER,
        service: serviceName,
        desiredCount: 0,
      }));
      console.log(`[ECS] Scaled service to 0`);

      // Wait a bit for tasks to drain
      await new Promise(resolve => setTimeout(resolve, 5000));

      // 2. Delete service
      await this.ecs.send(new DeleteServiceCommand({
        cluster: ECS_CLUSTER,
        service: serviceName,
        force: true,
      }));
      console.log(`[ECS] Deleted service`);
    } catch (error: unknown) {
      // Service might not exist
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`[ECS] Service delete error (may not exist): ${errorMessage}`);
    }

    // 3. Delete user-specific task definition
    try {
      const taskDefName = `openclaw-${params.instanceId.slice(0, 8)}`;
      await this.ecs.send(new DeregisterTaskDefinitionCommand({
        taskDefinition: `${taskDefName}:1`,
      }));
      console.log(`[ECS] Deregistered task definition`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`[ECS] Task definition deregister error: ${errorMessage}`);
    }

    // 4. Delete listener rule
    if (params.ruleArn) {
      await this.deleteListenerRule(params.ruleArn);
    } else {
      await this.deleteListenerRuleByServiceName(serviceName);
    }

    // 5. Delete target group
    if (params.targetGroupArn) {
      await this.deleteTargetGroup(params.targetGroupArn);
    } else {
      await this.deleteTargetGroupByName(serviceName);
    }

    // 6. Delete secret
    await this.deleteUserSecret(params.instanceId);
    console.log(`[ECS] Instance ${params.instanceId} fully deleted`);
  }

  /**
   * Register a user-specific task definition with secrets
   */
  private async registerUserTaskDefinition(instanceId: string, secretArn: string): Promise<string> {
    const taskDefName = `openclaw-${instanceId.slice(0, 8)}`;
    const ecrRepo = process.env.ECR_REPOSITORY_URL || "";

    const cmd = new RegisterTaskDefinitionCommand({
      family: taskDefName,
      requiresCompatibilities: ["EC2"],
      networkMode: "awsvpc",
      cpu: "512",
      memory: "1536",
      executionRoleArn: process.env.ECS_EXECUTION_ROLE_ARN,
      taskRoleArn: process.env.ECS_TASK_ROLE_ARN,
      containerDefinitions: [
        {
          name: "gateway",
          image: `${ecrRepo}:latest`,
          essential: true,
          portMappings: [
            {
              containerPort: 8080,
              hostPort: 8080,
              protocol: "tcp",
            },
          ],
          environment: [
            { name: "PORT", value: "8080" },
            { name: "NODE_ENV", value: "production" },
            { name: "OPENCLAW_STATE_DIR", value: "/tmp/.openclaw" },
            { name: "OPENCLAW_CONFIG_PATH", value: "/app/hosted-config.json" },
            { name: "INSTANCE_ID", value: instanceId },
          ],
          secrets: [
            {
              name: "OPENCLAW_GATEWAY_TOKEN",
              valueFrom: `${secretArn}:OPENCLAW_GATEWAY_TOKEN::`,
            },
            {
              name: "ANTHROPIC_API_KEY",
              valueFrom: `${secretArn}:ANTHROPIC_API_KEY::`,
            },
          ],
          logConfiguration: {
            logDriver: "awslogs",
            options: {
              "awslogs-group": "/ecs/openclaw",
              "awslogs-region": AWS_REGION,
              "awslogs-stream-prefix": `gateway-${instanceId.slice(0, 8)}`,
            },
          },
          healthCheck: {
            command: ["CMD-SHELL", "curl -f http://localhost:8080/health || exit 1"],
            interval: 30,
            timeout: 5,
            retries: 3,
            startPeriod: 60,
          },
        },
      ],
    });

    const result = await this.ecs.send(cmd);
    return result.taskDefinition?.taskDefinitionArn || "";
  }

  /**
   * Create a secret in Secrets Manager for user credentials
   */
  private async createUserSecret(
    instanceId: string,
    secrets: Record<string, string>
  ): Promise<string> {
    const secretName = `openclaw/${instanceId}`;

    const cmd = new CreateSecretCommand({
      Name: secretName,
      SecretString: JSON.stringify(secrets),
      Description: `Credentials for OpenClaw instance ${instanceId}`,
    });

    const result = await this.secrets.send(cmd);
    return result.ARN || "";
  }

  /**
   * Delete a user's secret
   */
  private async deleteUserSecret(instanceId: string): Promise<void> {
    try {
      await this.secrets.send(new DeleteSecretCommand({
        SecretId: `openclaw/${instanceId}`,
        ForceDeleteWithoutRecovery: true,
      }));
      console.log(`[ECS] Deleted secret for ${instanceId}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`[ECS] Secret delete error: ${errorMessage}`);
    }
  }

  /**
   * Create a target group for routing traffic to the user's service
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
      await this.elb.send(new DeleteTargetGroupCommand({
        TargetGroupArn: targetGroupArn,
      }));
      console.log(`[ECS] Deleted target group`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`[ECS] Target group delete error: ${errorMessage}`);
    }
  }

  /**
   * Delete target group by name (lookup ARN first)
   */
  private async deleteTargetGroupByName(serviceName: string): Promise<void> {
    // Would need to use DescribeTargetGroups to find the ARN
    // For now, we'll rely on the stored ARN in the database
    console.log(`[ECS] Skipping target group deletion by name (no ARN stored)`);
  }

  /**
   * Create an ALB listener rule for routing
   * Uses path-based routing in HTTP-only mode, host-based routing with custom domain
   */
  private async createListenerRule(
    serviceName: string,
    subdomain: string,
    targetGroupArn: string
  ): Promise<string> {
    // Generate a unique priority (1-50000)
    // Use hash of instanceId for consistency
    const priority = this.generatePriority(serviceName);

    // Condition depends on routing mode
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
      await this.elb.send(new DeleteRuleCommand({
        RuleArn: ruleArn,
      }));
      console.log(`[ECS] Deleted listener rule`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`[ECS] Listener rule delete error: ${errorMessage}`);
    }
  }

  /**
   * Delete listener rule by finding it (lookup by service name)
   */
  private async deleteListenerRuleByServiceName(serviceName: string): Promise<void> {
    try {
      const rulesResult = await this.elb.send(new DescribeRulesCommand({
        ListenerArn: ALB_LISTENER_ARN,
      }));

      const subdomain = serviceName.replace("openclaw-", "");

      for (const rule of rulesResult.Rules || []) {
        // Check for path-pattern condition (HTTP-only mode)
        const pathCondition = rule.Conditions?.find(c => c.Field === "path-pattern");
        if (pathCondition?.Values?.some(v => v.includes(`/${subdomain}`)) && rule.RuleArn) {
          await this.deleteListenerRule(rule.RuleArn);
          return;
        }

        // Check for host-header condition (custom domain mode)
        const hostCondition = rule.Conditions?.find(c => c.Field === "host-header");
        if (hostCondition?.Values?.includes(`${subdomain}.${DOMAIN_NAME}`) && rule.RuleArn) {
          await this.deleteListenerRule(rule.RuleArn);
          return;
        }
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`[ECS] Listener rule lookup error: ${errorMessage}`);
    }
  }

  /**
   * Generate a deterministic priority from service name
   */
  private generatePriority(serviceName: string): number {
    let hash = 0;
    for (let i = 0; i < serviceName.length; i++) {
      const char = serviceName.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    // Map to range 1-50000 (keeping some room for manual rules)
    return Math.abs(hash % 49999) + 1;
  }

  /**
   * Get service name from instance ID
   */
  private getServiceName(instanceId: string): string {
    return `openclaw-${instanceId.slice(0, 8)}`;
  }
}

// Singleton instance
let client: ECSClawClient | null = null;

export function getECSClient(): ECSClawClient {
  if (!client) {
    client = new ECSClawClient();
  }
  return client;
}
