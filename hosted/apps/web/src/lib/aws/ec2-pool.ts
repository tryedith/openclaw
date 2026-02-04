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
  SSMClient,
  SendCommandCommand,
  GetCommandInvocationCommand,
} from "@aws-sdk/client-ssm";
import {
  ElasticLoadBalancingV2Client,
  RegisterTargetsCommand,
  DeregisterTargetsCommand,
} from "@aws-sdk/client-elastic-load-balancing-v2";

// Configuration from environment
const AWS_REGION = process.env.AWS_REGION || "us-west-2";
const LAUNCH_TEMPLATE_ID = process.env.LAUNCH_TEMPLATE_ID!;
const SUBNET_IDS = (process.env.SUBNET_IDS || "").split(",").filter(Boolean);
const ECR_REPOSITORY_URL = process.env.ECR_REPOSITORY_URL!;
const POOL_SPARE_COUNT = parseInt(process.env.POOL_SPARE_COUNT || "2", 10);

interface PoolInstance {
  instanceId: string;
  status: "initializing" | "available" | "assigned";
  privateIp?: string;
  publicIp?: string;
  userId?: string;
  launchTime?: Date;
}

interface AssignInstanceParams {
  userId: string;
  instanceId: string;  // OpenClaw instance ID (not EC2 instance ID)
  secretArn: string;
}

export class EC2PoolManager {
  private ec2: EC2Client;
  private ssm: SSMClient;
  private elb: ElasticLoadBalancingV2Client;

  constructor() {
    const config = { region: AWS_REGION };
    this.ec2 = new EC2Client(config);
    this.ssm = new SSMClient(config);
    this.elb = new ElasticLoadBalancingV2Client(config);
  }

  /**
   * Get all instances in the pool
   */
  async getPoolInstances(): Promise<PoolInstance[]> {
    const response = await this.ec2.send(
      new DescribeInstancesCommand({
        Filters: [
          {
            Name: "tag:Name",
            Values: ["openclaw-user-instance"],
          },
          {
            Name: "instance-state-name",
            Values: ["pending", "running"],
          },
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
          launchTime: instance.LaunchTime,
        });
      }
    }

    return instances;
  }

  /**
   * Get available (unassigned) instances
   */
  async getAvailableInstances(): Promise<PoolInstance[]> {
    const instances = await this.getPoolInstances();
    return instances.filter((i) => i.status === "available");
  }

  /**
   * Get assigned instances
   */
  async getAssignedInstances(): Promise<PoolInstance[]> {
    const instances = await this.getPoolInstances();
    return instances.filter((i) => i.status === "assigned");
  }

  /**
   * Launch new instances to maintain pool size
   */
  async maintainPool(targetSpare: number = POOL_SPARE_COUNT): Promise<void> {
    const available = await this.getAvailableInstances();
    const needed = targetSpare - available.length;

    if (needed > 0) {
      console.log(`[Pool] Launching ${needed} instance(s) to maintain pool`);
      await this.launchInstances(needed);
    }
  }

  /**
   * Launch new instances
   */
  async launchInstances(count: number): Promise<string[]> {
    const response = await this.ec2.send(
      new RunInstancesCommand({
        LaunchTemplate: {
          LaunchTemplateId: LAUNCH_TEMPLATE_ID,
        },
        MinCount: count,
        MaxCount: count,
        SubnetId: SUBNET_IDS[Math.floor(Math.random() * SUBNET_IDS.length)],
      })
    );

    const instanceIds = response.Instances?.map((i: Instance) => i.InstanceId!) || [];
    console.log(`[Pool] Launched instances: ${instanceIds.join(", ")}`);

    return instanceIds;
  }

  /**
   * Assign an available instance to a user
   */
  async assignToUser(params: AssignInstanceParams): Promise<{
    ec2InstanceId: string;
    privateIp: string;
    publicIp: string;
  }> {
    const { userId, instanceId, secretArn } = params;

    // 1. Get available instance
    const available = await this.getAvailableInstances();
    if (available.length === 0) {
      throw new Error("No instances available in pool");
    }

    const instance = available[0];
    console.log(`[Pool] Assigning instance ${instance.instanceId} to user ${userId}`);

    // 2. Tag as assigned (before starting container to prevent race conditions)
    await this.ec2.send(
      new CreateTagsCommand({
        Resources: [instance.instanceId],
        Tags: [
          { Key: "Status", Value: "assigned" },
          { Key: "UserId", Value: userId },
          { Key: "OpenClawInstanceId", Value: instanceId },
          { Key: "AssignedAt", Value: new Date().toISOString() },
        ],
      })
    );

    // 3. Start container via SSM
    await this.startContainerOnInstance(instance.instanceId, secretArn);

    // 4. Replenish pool in background (don't await)
    this.maintainPool().catch((err) => {
      console.error("[Pool] Failed to replenish pool:", err);
    });

    return {
      ec2InstanceId: instance.instanceId,
      privateIp: instance.privateIp!,
      publicIp: instance.publicIp!,
    };
  }

  /**
   * Start the OpenClaw container on an instance via SSM
   */
  async startContainerOnInstance(ec2InstanceId: string, secretArn: string): Promise<void> {
    const script = `
#!/bin/bash
set -e

SECRET_ARN="${secretArn}"
ECR_IMAGE="${ECR_REPOSITORY_URL}:latest"
REGION="${AWS_REGION}"

# Stop any existing container
docker stop openclaw-gateway 2>/dev/null || true
docker rm openclaw-gateway 2>/dev/null || true

# Login to ECR
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $(echo $ECR_IMAGE | cut -d'/' -f1)

# Pull latest image
docker pull $ECR_IMAGE

# Get secrets
SECRETS=$(aws secretsmanager get-secret-value --region $REGION --secret-id $SECRET_ARN --query SecretString --output text)
GATEWAY_TOKEN=$(echo $SECRETS | jq -r .OPENCLAW_GATEWAY_TOKEN)
API_KEY=$(echo $SECRETS | jq -r .ANTHROPIC_API_KEY)

# Run container
docker run -d \\
  --name openclaw-gateway \\
  --restart=always \\
  -p 8080:8080 \\
  -e OPENCLAW_GATEWAY_TOKEN="$GATEWAY_TOKEN" \\
  -e ANTHROPIC_API_KEY="$API_KEY" \\
  -e PORT=8080 \\
  -e NODE_ENV=production \\
  $ECR_IMAGE

echo "Container started successfully"
`;

    console.log(`[Pool] Starting container on instance ${ec2InstanceId}`);

    const sendCommandResponse = await this.ssm.send(
      new SendCommandCommand({
        InstanceIds: [ec2InstanceId],
        DocumentName: "AWS-RunShellScript",
        Parameters: {
          commands: [script],
        },
        TimeoutSeconds: 300,
      })
    );

    const commandId = sendCommandResponse.Command?.CommandId!;

    // Wait for command to complete (with timeout)
    const maxWaitTime = 120000; // 2 minutes
    const startTime = Date.now();
    let status = "InProgress";

    while (status === "InProgress" || status === "Pending") {
      if (Date.now() - startTime > maxWaitTime) {
        throw new Error(`SSM command timed out after ${maxWaitTime}ms`);
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const invocationResponse = await this.ssm.send(
        new GetCommandInvocationCommand({
          CommandId: commandId,
          InstanceId: ec2InstanceId,
        })
      );

      status = invocationResponse.Status || "Unknown";

      if (status === "Failed" || status === "Cancelled" || status === "TimedOut") {
        throw new Error(
          `SSM command failed with status ${status}: ${invocationResponse.StandardErrorContent}`
        );
      }
    }

    console.log(`[Pool] Container started on instance ${ec2InstanceId}`);
  }

  /**
   * Release an instance (when user deletes their instance)
   */
  async releaseInstance(userId: string): Promise<void> {
    // Find instance assigned to this user
    const instances = await this.getPoolInstances();
    const instance = instances.find((i) => i.userId === userId);

    if (!instance) {
      console.log(`[Pool] No instance found for user ${userId}`);
      return;
    }

    console.log(`[Pool] Releasing instance ${instance.instanceId} from user ${userId}`);

    // Terminate the instance
    await this.ec2.send(
      new TerminateInstancesCommand({
        InstanceIds: [instance.instanceId],
      })
    );

    // Replenish pool
    await this.maintainPool();
  }

  /**
   * Get instance assigned to a specific user
   */
  async getInstanceForUser(userId: string): Promise<PoolInstance | null> {
    const instances = await this.getPoolInstances();
    return instances.find((i) => i.userId === userId) || null;
  }

  /**
   * Register instance with ALB target group
   */
  async registerWithTargetGroup(
    targetGroupArn: string,
    ec2InstanceId: string,
    port: number = 8080
  ): Promise<void> {
    // Get instance private IP
    const instances = await this.getPoolInstances();
    const instance = instances.find((i) => i.instanceId === ec2InstanceId);

    if (!instance?.privateIp) {
      throw new Error(`Instance ${ec2InstanceId} not found or has no private IP`);
    }

    await this.elb.send(
      new RegisterTargetsCommand({
        TargetGroupArn: targetGroupArn,
        Targets: [
          {
            Id: instance.privateIp,
            Port: port,
          },
        ],
      })
    );

    console.log(`[Pool] Registered ${instance.privateIp}:${port} with target group`);
  }

  /**
   * Deregister instance from ALB target group
   */
  async deregisterFromTargetGroup(
    targetGroupArn: string,
    privateIp: string,
    port: number = 8080
  ): Promise<void> {
    await this.elb.send(
      new DeregisterTargetsCommand({
        TargetGroupArn: targetGroupArn,
        Targets: [
          {
            Id: privateIp,
            Port: port,
          },
        ],
      })
    );

    console.log(`[Pool] Deregistered ${privateIp}:${port} from target group`);
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
    const instances = await this.getPoolInstances();
    return {
      total: instances.length,
      available: instances.filter((i) => i.status === "available").length,
      assigned: instances.filter((i) => i.status === "assigned").length,
      initializing: instances.filter((i) => i.status === "initializing").length,
    };
  }
}

// Singleton instance
let poolManager: EC2PoolManager | null = null;

export function getEC2PoolManager(): EC2PoolManager {
  if (!poolManager) {
    poolManager = new EC2PoolManager();
  }
  return poolManager;
}
