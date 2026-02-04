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

const AWS_REGION = process.env.AWS_REGION || "us-west-2";
const LAUNCH_TEMPLATE_ID = process.env.LAUNCH_TEMPLATE_ID!;
const POOL_SPARE_COUNT = parseInt(process.env.POOL_SPARE_COUNT || "2", 10);

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

export class EC2PoolManager {
  private ec2: EC2Client;
  private elb: ElasticLoadBalancingV2Client;

  constructor() {
    const config = { region: AWS_REGION };
    this.ec2 = new EC2Client(config);
    this.elb = new ElasticLoadBalancingV2Client(config);
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
        const gatewayTokenTag = instance.Tags?.find((t: Tag) => t.Key === "GatewayToken");
        instances.push({
          instanceId: instance.InstanceId!,
          status: (statusTag?.Value as PoolInstance["status"]) || "initializing",
          privateIp: instance.PrivateIpAddress,
          publicIp: instance.PublicIpAddress,
          userId: userIdTag?.Value,
          gatewayToken: gatewayTokenTag?.Value,
        });
      }
    }
    return instances;
  }

  async getAvailableInstances(): Promise<PoolInstance[]> {
    const instances = await this.getPoolInstances();
    return instances.filter((i) => i.status === "available");
  }

  async launchInstances(count: number): Promise<string[]> {
    const response = await this.ec2.send(
      new RunInstancesCommand({
        LaunchTemplate: { LaunchTemplateId: LAUNCH_TEMPLATE_ID },
        MinCount: count,
        MaxCount: count,
      })
    );
    return response.Instances?.map((i: Instance) => i.InstanceId!) || [];
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
    const available = await this.getAvailableInstances();
    const needed = POOL_SPARE_COUNT - available.length;
    if (needed > 0) {
      await this.launchInstances(needed);
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

    if (!instance.gatewayToken) {
      throw new Error(`Instance ${instance.instanceId} has no gateway token`);
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
    this.maintainPool().catch(() => {});

    return {
      ec2InstanceId: instance.instanceId,
      privateIp: instance.privateIp!,
      publicIp: instance.publicIp!,
      gatewayToken: instance.gatewayToken,
    };
  }

  async releaseInstance(userId: string): Promise<void> {
    const instances = await this.getPoolInstances();
    const instance = instances.find((i) => i.userId === userId);
    if (!instance) return;

    await this.ec2.send(
      new TerminateInstancesCommand({ InstanceIds: [instance.instanceId] })
    );
    await this.maintainPool();
  }

  async getInstanceForUser(userId: string): Promise<PoolInstance | null> {
    const instances = await this.getPoolInstances();
    return instances.find((i) => i.userId === userId) || null;
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
