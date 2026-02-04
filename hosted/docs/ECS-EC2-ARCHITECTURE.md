# OpenClaw Hosted Platform - ECS + EC2 Architecture (Legacy)

> **Note**: This document describes the original ECS-based architecture. The platform is transitioning to dedicated EC2 instances per user. See `EC2-PER-USER-ARCHITECTURE.md` for the new approach.

## Overview

The original hosted platform uses AWS ECS (Elastic Container Service) with EC2 Spot instances for cost-effective container hosting. Multiple users' tasks share EC2 instances (multi-tenant bin-packing).

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AWS (us-west-2)                                │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                    Application Load Balancer                          │  │
│  │                    (path-based routing)                               │  │
│  │                    /{instanceId}/* → Target Group                     │  │
│  └─────────────────────────────┬─────────────────────────────────────────┘  │
│                                │                                            │
│  ┌─────────────────────────────▼─────────────────────────────────────────┐  │
│  │                       ECS Cluster                                     │  │
│  │                       (openclaw-cluster)                              │  │
│  │                                                                       │  │
│  │   ┌─────────────────────────────────────────────────────────────┐    │  │
│  │   │              Capacity Provider: openclaw-spot               │    │  │
│  │   │              (backed by EC2 Auto Scaling Group)             │    │  │
│  │   └─────────────────────────────────────────────────────────────┘    │  │
│  │                                                                       │  │
│  │   EC2 Instance 1 (c7i-flex.large)    EC2 Instance 2 (m7i-flex.large) │  │
│  │   ┌─────────────────────────────┐    ┌─────────────────────────────┐ │  │
│  │   │ ┌─────────┐ ┌─────────┐    │    │ ┌─────────┐ ┌─────────┐    │ │  │
│  │   │ │ User A  │ │ User B  │    │    │ │ User C  │ │ User D  │    │ │  │
│  │   │ │ Task    │ │ Task    │    │    │ │ Task    │ │ Task    │    │ │  │
│  │   │ │ 1.5GB   │ │ 1.5GB   │    │    │ │ 1.5GB   │ │ 1.5GB   │    │ │  │
│  │   │ └─────────┘ └─────────┘    │    │ └─────────┘ └─────────┘    │ │  │
│  │   │         (awsvpc mode)       │    │         (awsvpc mode)      │ │  │
│  │   └─────────────────────────────┘    └─────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │  NAT Gateway    │  │ Secrets Manager │  │   ECR Repo      │             │
│  │  (required for  │  │ (per-user       │  │   (openclaw     │             │
│  │   awsvpc mode)  │  │  credentials)   │  │    image)       │             │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Components

### ECS Cluster
- **Name**: `openclaw-cluster`
- **Container Insights**: Enabled
- **Capacity Provider**: `openclaw-spot` (EC2-based)

### Capacity Provider
- **Type**: Auto Scaling Group provider
- **Managed Scaling**: Enabled (target capacity 100%)
- **Managed Termination Protection**: Enabled
- **Managed Draining**: Enabled

### Auto Scaling Group
- **Name**: `openclaw-ecs-asg`
- **Min Size**: 1
- **Max Size**: 20
- **Instance Types**: `c7i-flex.large` (4GB), `m7i-flex.large` (8GB)
- **Spot Strategy**: `capacity-optimized`
- **On-Demand Base**: 1 (always 1 reliable instance)

### Task Configuration
- **CPU**: 512 units (0.5 vCPU)
- **Memory**: 1536 MB
- **Network Mode**: `awsvpc` (each task gets own ENI)
- **Launch Type**: EC2 (via capacity provider)

### Networking
- **VPC**: Custom VPC with public and private subnets
- **NAT Gateway**: Required (tasks in private subnets with awsvpc mode)
- **ALB**: Application Load Balancer with path-based routing

## Key Files

| File | Description |
|------|-------------|
| `terraform/ecs.tf` | ECS cluster, capacity provider configuration |
| `terraform/asg.tf` | Auto Scaling Group, launch template |
| `terraform/alb.tf` | Application Load Balancer |
| `terraform/vpc.tf` | VPC, subnets, NAT Gateway |
| `terraform/task-definition.tf` | Base ECS task definition |
| `web/src/lib/aws/ecs-client.ts` | User instance deployment logic |

## User Deployment Flow

```
1. User creates instance via Web UI
   ↓
2. Create secret in Secrets Manager
   (ANTHROPIC_API_KEY, GATEWAY_TOKEN)
   ↓
3. Register user-specific task definition
   (injects secrets from Secrets Manager)
   ↓
4. Create ALB Target Group
   ↓
5. Create ALB Listener Rule
   (path: /{instanceId}/* → target group)
   ↓
6. Create ECS Service
   (desiredCount: 1, uses capacity provider)
   ↓
7. Capacity Provider places task
   - If room on existing instance → place immediately
   - If no room → trigger ASG scale-up → wait for instance → place
```

## Scaling Behavior

### Scale Up
1. New service created with `capacityProviderStrategy`
2. ECS requests capacity from provider
3. If no room, provider increases ASG desired capacity
4. New EC2 instance launches (~2-4 minutes)
5. Instance joins cluster, task gets placed

### Scale Down
1. Service deleted → task stops
2. If instance has 0 tasks → becomes idle
3. Capacity reservation metric drops below 100%
4. After 15 minutes at <100%, scale-down triggers
5. ECS removes termination protection from idle instance
6. ASG terminates instance

## Cost Breakdown (10 Users)

| Component | Monthly Cost |
|-----------|-------------|
| EC2 Spot (5 instances) | ~$55 |
| NAT Gateway | ~$37 |
| ALB | ~$22 |
| Secrets Manager | ~$4.50 |
| CloudWatch Logs | ~$3 |
| ECR | ~$1 |
| **Total** | **~$122.50** |
| **Per User** | **~$12.25** |

## Pros and Cons

### Pros
- Cost efficient at scale (bin-packing)
- Automatic placement by ECS
- Built-in health checks and restart
- Secrets injection via task definition

### Cons
- **Noisy neighbor**: Users share instances
- **Scale-up delay**: 2-4 minutes when full
- **NAT Gateway cost**: Required for awsvpc mode
- **Complexity**: ECS concepts (tasks, services, capacity providers)
- **Debugging**: Logs mixed across users on same instance

## Why We Moved Away

1. **Slow provisioning**: 2-4 minute wait when instances are full
2. **No user isolation**: Tasks from different users share resources
3. **NAT Gateway cost**: $37/month fixed cost
4. **Complexity**: ECS abstractions add overhead

See `EC2-PER-USER-ARCHITECTURE.md` for the replacement architecture.
