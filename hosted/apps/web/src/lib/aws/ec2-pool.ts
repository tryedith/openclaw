/**
 * EC2 Instance Pool Manager
 * Manages a pool of pre-initialized EC2 instances for instant user assignment
 */

import {
  EC2Client,
  RunInstancesCommand,
  TerminateInstancesCommand,
  DescribeInstancesCommand,
  CreateTagsCommand,
  waitUntilInstanceRunning,
  Tag,
  Instance,
} from "@aws-sdk/client-ec2";
import {
  ElasticLoadBalancingV2Client,
  RegisterTargetsCommand,
  DeregisterTargetsCommand,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  DeleteSecretCommand,
} from "@aws-sdk/client-secrets-manager";

const AWS_REGION = process.env.AWS_REGION || "us-west-2";
const LAUNCH_TEMPLATE_ID = process.env.LAUNCH_TEMPLATE_ID!;
const POOL_SPARE_COUNT = parseInt(process.env.POOL_SPARE_COUNT || "2", 10);
const SUBNET_IDS = (process.env.SUBNET_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter((value) => value.length > 0);
const SECURITY_GROUP_IDS = (process.env.SECURITY_GROUP_ID || "")
  .split(",")
  .map((value) => value.trim())
  .filter((value) => value.length > 0);

interface PoolInstance {
  instanceId: string;
  status: "initializing" | "available" | "assigned";
  privateIp?: string;
  publicIp?: string;
  userId?: string;
  gatewayToken?: string;
}

interface AssignInstanceParams {
  userId: string;
  instanceId: string;
}

function getErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "UnknownError";
  const code = (error as { Code?: unknown; code?: unknown }).Code;
  if (typeof code === "string" && code.length > 0) return code;
  const lowerCode = (error as { code?: unknown }).code;
  if (typeof lowerCode === "string" && lowerCode.length > 0) return lowerCode;
  return "UnknownError";
}

function getErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return String(error);
  const message = (error as { message?: unknown; Message?: unknown }).message;
  if (typeof message === "string" && message.length > 0) return message;
  const upperMessage = (error as { Message?: unknown }).Message;
  if (typeof upperMessage === "string" && upperMessage.length > 0) return upperMessage;
  return String(error);
}

export class EC2PoolManager {
  private ec2: EC2Client;
  private elb: ElasticLoadBalancingV2Client;
  private secrets: SecretsManagerClient;

  constructor() {
    const config = { region: AWS_REGION };
    this.ec2 = new EC2Client(config);
    this.elb = new ElasticLoadBalancingV2Client(config);
    this.secrets = new SecretsManagerClient(config);
  }

  async getPoolInstances(): Promise<PoolInstance[]> {
    const response = await this.ec2.send(
      new DescribeInstancesCommand({
        Filters: [
          { Name: "tag:Name", Values: ["openclaw-user-instance"] },
          { Name: "instance-state-name", Values: ["pending", "running"] },
        ],
      })
    );

    const instances: PoolInstance[] = [];
    for (const reservation of response.Reservations || []) {
      for (const instance of reservation.Instances || []) {
        const statusTag = instance.Tags?.find((t: Tag) => t.Key === "Status");
        const userIdTag = instance.Tags?.find((t: Tag) => t.Key === "UserId");
        instances.push({
          instanceId: instance.InstanceId!,
          status: (statusTag?.Value as PoolInstance["status"]) || "initializing",
          privateIp: instance.PrivateIpAddress,
          publicIp: instance.PublicIpAddress,
          userId: userIdTag?.Value,
        });
      }
    }
    return instances;
  }

  async getAvailableInstances(): Promise<PoolInstance[]> {
    const instances = await this.getPoolInstances();
    return instances.filter((i) => i.status === "available");
  }

  private async launchSingleInstance(
    candidateSubnets: string[],
    offset: number
  ): Promise<string> {
    if (candidateSubnets.length === 0) {
      const response = await this.ec2.send(
        new RunInstancesCommand({
          LaunchTemplate: { LaunchTemplateId: LAUNCH_TEMPLATE_ID },
          MinCount: 1,
          MaxCount: 1,
        })
      );
      const instanceId = response.Instances?.[0]?.InstanceId;
      if (!instanceId) {
        throw new Error("EC2 RunInstances returned no instance ID");
      }
      return instanceId;
    }

    if (SECURITY_GROUP_IDS.length === 0) {
      throw new Error(
        "SECURITY_GROUP_ID must be set when SUBNET_IDS is configured (required for multi-AZ launches)"
      );
    }

    const attempts: string[] = [];
    for (let i = 0; i < candidateSubnets.length; i++) {
      const subnet = candidateSubnets[(offset + i) % candidateSubnets.length]!;
      try {
        const response = await this.ec2.send(
          new RunInstancesCommand({
            LaunchTemplate: { LaunchTemplateId: LAUNCH_TEMPLATE_ID },
            MinCount: 1,
            MaxCount: 1,
            // The launch template uses NetworkInterfaces, so we must override that block rather than
            // passing SubnetId (otherwise the API rejects the request).
            NetworkInterfaces: [
              {
                DeviceIndex: 0,
                SubnetId: subnet,
                Groups: SECURITY_GROUP_IDS,
                AssociatePublicIpAddress: true,
              },
            ],
          })
        );
        const instanceId = response.Instances?.[0]?.InstanceId;
        if (!instanceId) {
          throw new Error(`EC2 RunInstances returned no instance ID for subnet ${subnet}`);
        }
        return instanceId;
      } catch (error) {
        const code = getErrorCode(error);
        const message = getErrorMessage(error);
        attempts.push(`${subnet}:${code}:${message}`);
      }
    }

    throw new Error(
      `Failed to launch instance in all configured subnets (${candidateSubnets.join(",")}): ${attempts.join(
        " | "
      )}`
    );
  }

  async launchInstances(count: number): Promise<string[]> {
    const launchedInstanceIds: string[] = [];
    for (let i = 0; i < count; i++) {
      const instanceId = await this.launchSingleInstance(SUBNET_IDS, i);
      launchedInstanceIds.push(instanceId);
    }
    return launchedInstanceIds;
  }

  async waitForInstanceReady(instanceId: string, timeoutMs: number = 180000): Promise<void> {
    await waitUntilInstanceRunning(
      { client: this.ec2, maxWaitTime: 120 },
      { InstanceIds: [instanceId] }
    );

    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const instances = await this.getPoolInstances();
      const instance = instances.find((i) => i.instanceId === instanceId);
      if (instance?.status === "available") return;
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    throw new Error(`Instance ${instanceId} did not become available within timeout`);
  }

  async maintainPool(): Promise<void> {
    const instances = await this.getPoolInstances();
    // Count both available and initializing instances towards the spare pool
    // to avoid launching duplicates while instances are still booting
    const spareCount = instances.filter(
      (i) => i.status === "available" || i.status === "initializing"
    ).length;
    const needed = POOL_SPARE_COUNT - spareCount;
    if (needed > 0) {
      try {
        await this.launchInstances(needed);
      } catch (error) {
        console.error("[ec2-pool] maintainPool failed", {
          code: getErrorCode(error),
          message: getErrorMessage(error),
          needed,
          spareCount,
          poolSpareCount: POOL_SPARE_COUNT,
          subnetsConfigured: SUBNET_IDS.length,
        });
        throw error;
      }
    }
  }

  async assignToUser(params: AssignInstanceParams): Promise<{
    ec2InstanceId: string;
    privateIp: string;
    publicIp: string;
    gatewayToken: string;
  }> {
    const { userId, instanceId } = params;

    // Get available instance (container already running), or launch one if pool is empty
    let available = await this.getAvailableInstances();
    if (available.length === 0) {
      const [newInstanceId] = await this.launchInstances(1);
      await this.waitForInstanceReady(newInstanceId);
      available = await this.getAvailableInstances();
    }

    const instance = available[0];

    // Read gateway token from Secrets Manager (stored by EC2 user_data at boot)
    const secretResult = await this.secrets.send(
      new GetSecretValueCommand({
        SecretId: `openclaw/instance/${instance.instanceId}/gateway-token`,
      })
    );
    const gatewayToken = secretResult.SecretString;
    if (!gatewayToken) {
      throw new Error(`Instance ${instance.instanceId} has no gateway token in Secrets Manager`);
    }

    // Tag as assigned (container is already running from user_data)
    await this.ec2.send(
      new CreateTagsCommand({
        Resources: [instance.instanceId],
        Tags: [
          { Key: "Status", Value: "assigned" },
          { Key: "UserId", Value: userId },
          { Key: "OpenClawInstanceId", Value: instanceId },
        ],
      })
    );

    // Replenish pool in background
    this.maintainPool().catch((error) => {
      // Don't crash the request; the pool is a best-effort background replenishment. But do log.
      console.error("[ec2-pool] maintainPool failed (background)", {
        code: getErrorCode(error),
        message: getErrorMessage(error),
        userId,
        instanceId,
      });
    });

    return {
      ec2InstanceId: instance.instanceId,
      privateIp: instance.privateIp!,
      publicIp: instance.publicIp!,
      gatewayToken,
    };
  }

  async releaseInstance(ec2InstanceId: string): Promise<void> {
    const instance = await this.getInstanceByEC2Id(ec2InstanceId);
    if (!instance) return;

    // Clean up gateway token from Secrets Manager
    try {
      await this.secrets.send(
        new DeleteSecretCommand({
          SecretId: `openclaw/instance/${instance.instanceId}/gateway-token`,
          ForceDeleteWithoutRecovery: true,
        })
      );
    } catch (error) {
      console.log(`[ec2-pool] Secret cleanup for ${instance.instanceId}: ${getErrorMessage(error)}`);
    }

    await this.ec2.send(
      new TerminateInstancesCommand({ InstanceIds: [instance.instanceId] })
    );
    await this.maintainPool();
  }

  async getInstanceByEC2Id(ec2InstanceId: string): Promise<PoolInstance | null> {
    const instances = await this.getPoolInstances();
    return instances.find((i) => i.instanceId === ec2InstanceId) || null;
  }

  async registerWithTargetGroup(targetGroupArn: string, ec2InstanceId: string): Promise<void> {
    const instances = await this.getPoolInstances();
    const instance = instances.find((i) => i.instanceId === ec2InstanceId);
    if (!instance?.privateIp) {
      throw new Error(`Instance ${ec2InstanceId} not found`);
    }

    await this.elb.send(
      new RegisterTargetsCommand({
        TargetGroupArn: targetGroupArn,
        Targets: [{ Id: instance.privateIp, Port: 8080 }],
      })
    );
  }

  async deregisterFromTargetGroup(targetGroupArn: string, privateIp: string): Promise<void> {
    await this.elb.send(
      new DeregisterTargetsCommand({
        TargetGroupArn: targetGroupArn,
        Targets: [{ Id: privateIp, Port: 8080 }],
      })
    );
  }

  async getPoolStats() {
    const instances = await this.getPoolInstances();
    return {
      total: instances.length,
      available: instances.filter((i) => i.status === "available").length,
      assigned: instances.filter((i) => i.status === "assigned").length,
      initializing: instances.filter((i) => i.status === "initializing").length,
    };
  }
}

let poolManager: EC2PoolManager | null = null;

export function getEC2PoolManager(): EC2PoolManager {
  if (!poolManager) {
    poolManager = new EC2PoolManager();
  }
  return poolManager;
}
