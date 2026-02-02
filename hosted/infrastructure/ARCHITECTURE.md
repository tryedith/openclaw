# OpenClaw Hosted Platform - AWS Architecture

## Overview

The OpenClaw hosted platform runs on AWS ECS with EC2 Spot instances, providing cost-effective container hosting for user instances.

---

## Current Infrastructure

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                    AWS Account                                       │
│                                  (991176603470)                                      │
│                                  Region: us-west-2                                   │
│                                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────────┐    │
│  │                              VPC (10.0.0.0/16)                               │    │
│  │                            vpc-0573bd83fca078c46                             │    │
│  │                                                                              │    │
│  │   ┌──────────────────────────────┐  ┌──────────────────────────────┐        │    │
│  │   │     Public Subnet (AZ-a)     │  │     Public Subnet (AZ-b)     │        │    │
│  │   │       10.0.1.0/24            │  │       10.0.2.0/24            │        │    │
│  │   │                              │  │                              │        │    │
│  │   │  ┌────────────────────────┐  │  │                              │        │    │
│  │   │  │   Application Load    │  │  │                              │        │    │
│  │   │  │      Balancer         │  │  │                              │        │    │
│  │   │  │                       │  │  │                              │        │    │
│  │   │  │ openclaw-alb-422...   │  │  │                              │        │    │
│  │   │  └───────────┬───────────┘  │  │                              │        │    │
│  │   │              │              │  │                              │        │    │
│  │   │  ┌───────────┴───────────┐  │  │                              │        │    │
│  │   │  │    NAT Gateway        │  │  │                              │        │    │
│  │   │  │  (for private subnet  │  │  │                              │        │    │
│  │   │  │   outbound access)    │  │  │                              │        │    │
│  │   │  └───────────┬───────────┘  │  │                              │        │    │
│  │   └──────────────┼──────────────┘  └──────────────────────────────┘        │    │
│  │                  │                                                          │    │
│  │   ┌──────────────┼──────────────┐  ┌──────────────────────────────┐        │    │
│  │   │     Private Subnet (AZ-a)   │  │     Private Subnet (AZ-b)    │        │    │
│  │   │       10.0.10.0/24          │  │       10.0.11.0/24           │        │    │
│  │   │              │              │  │                              │        │    │
│  │   │  ┌───────────▼───────────┐  │  │                              │        │    │
│  │   │  │   EC2 Instance        │  │  │  (scales here when needed)   │        │    │
│  │   │  │   c7i-flex.large      │  │  │                              │        │    │
│  │   │  │   i-05a7aa32c32bd3876 │  │  │                              │        │    │
│  │   │  │                       │  │  │                              │        │    │
│  │   │  │   ┌─────────────────┐ │  │  │                              │        │    │
│  │   │  │   │  ECS Agent      │ │  │  │                              │        │    │
│  │   │  │   │  (registered)   │ │  │  │                              │        │    │
│  │   │  │   └─────────────────┘ │  │  │                              │        │    │
│  │   │  │                       │  │  │                              │        │    │
│  │   │  │   ┌─────────────────┐ │  │  │                              │        │    │
│  │   │  │   │ (No tasks yet)  │ │  │  │                              │        │    │
│  │   │  │   │                 │ │  │  │                              │        │    │
│  │   │  │   └─────────────────┘ │  │  │                              │        │    │
│  │   │  └───────────────────────┘  │  │                              │        │    │
│  │   └─────────────────────────────┘  └──────────────────────────────┘        │    │
│  │                                                                              │    │
│  └──────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                      │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐                      │
│  │      ECR        │  │  ECS Cluster    │  │ Secrets Manager │                      │
│  │   openclaw:     │  │  openclaw-      │  │  (user creds)   │                      │
│  │   latest        │  │  cluster        │  │                 │                      │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘                      │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Resource Details

| Resource | ID/Name | Purpose | Monthly Cost |
|----------|---------|---------|--------------|
| VPC | `vpc-0573bd83fca078c46` | Network isolation | Free |
| Public Subnets | `subnet-000c13d14d0e4de3b`, `subnet-03b297367cd27afcb` | ALB, NAT Gateway | Free |
| Private Subnets | `subnet-03c50e41febb37e3a`, `subnet-0ea32a1c6b949fa50` | ECS Tasks | Free |
| NAT Gateway | `nat-0bb5ae4bc6ce111a4` | Outbound internet for private subnets | ~$32 |
| ALB | `openclaw-alb-422691962...` | Load balancing & routing | ~$16 |
| EC2 Instance | `i-050798d9de0deff7f` (c7i-flex.large) | Container host | ~$35 |
| ECS Cluster | `openclaw-cluster` | Container orchestration | Free |
| ECR Repository | `openclaw` | Docker image storage | ~$0.50 |
| CloudWatch Logs | `/ecs/openclaw` | Container logs | ~$1 |

**Current Total: ~$80/month** (no user instances)

---

## With User Instances (3 Users Example)

```
                                    Internet
                                        │
                                        ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                        Application Load Balancer                                   │
│                   openclaw-alb-422691962.us-west-2.elb.amazonaws.com              │
│                                                                                    │
│   Listener Rules:                                                                  │
│   ┌─────────────────────────────────────────────────────────────────────────────┐ │
│   │  Priority 1: Path /abc123/* → Target Group: openclaw-abc123                 │ │
│   │  Priority 2: Path /def456/* → Target Group: openclaw-def456                 │ │
│   │  Priority 3: Path /ghi789/* → Target Group: openclaw-ghi789                 │ │
│   │  Default:    Return 404 "Instance not found"                                │ │
│   └─────────────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────────┘
                                        │
            ┌───────────────────────────┼───────────────────────────┐
            ▼                           ▼                           ▼
   ┌─────────────────┐        ┌─────────────────┐        ┌─────────────────┐
   │  Target Group   │        │  Target Group   │        │  Target Group   │
   │  openclaw-      │        │  openclaw-      │        │  openclaw-      │
   │  abc123         │        │  def456         │        │  ghi789         │
   └────────┬────────┘        └────────┬────────┘        └────────┬────────┘
            │                          │                          │
            └──────────────────────────┼──────────────────────────┘
                                       │
                                       ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                              ECS Cluster: openclaw-cluster                         │
│                                                                                    │
│   ┌─────────────────────────────────────────────────────────────────────────────┐ │
│   │                    EC2 Instance: i-050798d9de0deff7f                        │ │
│   │                         c7i-flex.large (2 vCPU, 4GB RAM)                    │ │
│   │                                                                             │ │
│   │   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐            │ │
│   │   │   ECS Task      │  │   ECS Task      │  │   ECS Task      │            │ │
│   │   │   (User A)      │  │   (User B)      │  │   (User C)      │            │ │
│   │   │                 │  │                 │  │                 │            │ │
│   │   │ ┌─────────────┐ │  │ ┌─────────────┐ │  │ ┌─────────────┐ │            │ │
│   │   │ │  OpenClaw   │ │  │ │  OpenClaw   │ │  │ │  OpenClaw   │ │            │ │
│   │   │ │  Gateway    │ │  │ │  Gateway    │ │  │ │  Gateway    │ │            │ │
│   │   │ │  Container  │ │  │ │  Container  │ │  │ │  Container  │ │            │ │
│   │   │ │  :8080      │ │  │ │  :8080      │ │  │ │  :8080      │ │            │ │
│   │   │ └─────────────┘ │  │ └─────────────┘ │  │ └─────────────┘ │            │ │
│   │   │                 │  │                 │  │                 │            │ │
│   │   │ 512 CPU units   │  │ 512 CPU units   │  │ 512 CPU units   │            │ │
│   │   │ 1024 MB memory  │  │ 1024 MB memory  │  │ 1024 MB memory  │            │ │
│   │   └─────────────────┘  └─────────────────┘  └─────────────────┘            │ │
│   │                                                                             │ │
│   └─────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                    │
└───────────────────────────────────────────────────────────────────────────────────┘
```

---

## Auto-Scaling Architecture (10+ Users)

```
                                    Internet
                                        │
                                        ▼
                    ┌───────────────────────────────────────┐
                    │     Application Load Balancer          │
                    │     (handles all user routing)         │
                    └───────────────────┬───────────────────┘
                                        │
        ┌───────────────────────────────┼───────────────────────────────┐
        │                               │                               │
        ▼                               ▼                               ▼
┌───────────────────┐         ┌───────────────────┐         ┌───────────────────┐
│  Target Groups    │         │  Target Groups    │         │  Target Groups    │
│  (Users 1-4)      │         │  (Users 5-8)      │         │  (Users 9-12)     │
└─────────┬─────────┘         └─────────┬─────────┘         └─────────┬─────────┘
          │                             │                             │
          ▼                             ▼                             ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              ECS Cluster                                         │
│                                                                                  │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐      │
│  │  EC2 Spot Instance  │  │  EC2 Spot Instance  │  │  EC2 Spot Instance  │      │
│  │  c7i-flex.large     │  │  c7i-flex.large     │  │  c7i-flex.large     │      │
│  │  (AZ: us-west-2a)   │  │  (AZ: us-west-2b)   │  │  (AZ: us-west-2a)   │      │
│  │                     │  │                     │  │                     │      │
│  │  ┌───┐ ┌───┐ ┌───┐  │  │  ┌───┐ ┌───┐ ┌───┐  │  │  ┌───┐ ┌───┐ ┌───┐  │      │
│  │  │ 1 │ │ 2 │ │ 3 │  │  │  │ 5 │ │ 6 │ │ 7 │  │  │  │ 9 │ │10 │ │11 │  │      │
│  │  └───┘ └───┘ └───┘  │  │  └───┘ └───┘ └───┘  │  │  └───┘ └───┘ └───┘  │      │
│  │        ┌───┐        │  │        ┌───┐        │  │        ┌───┐        │      │
│  │        │ 4 │        │  │        │ 8 │        │  │        │12 │        │      │
│  │        └───┘        │  │        └───┘        │  │        └───┘        │      │
│  │                     │  │                     │  │                     │      │
│  │  4 tasks per host   │  │  4 tasks per host   │  │  4 tasks per host   │      │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘      │
│                                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                    Auto Scaling Group (ASG)                               │   │
│  │                                                                           │   │
│  │   Min: 1    Desired: 3    Max: 20                                        │   │
│  │                                                                           │   │
│  │   Scaling Policy: ECS Capacity Provider managed scaling                  │   │
│  │   - Scales up when tasks need more capacity                              │   │
│  │   - Scales down when instances are underutilized                         │   │
│  │   - Uses Spot instances (70% cheaper than on-demand)                     │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Request Flow

```
User Request: http://openclaw-alb-422691962.us-west-2.elb.amazonaws.com/abc123/chat

    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ 1. ALB receives request                                          │
│    - Checks listener rules                                       │
│    - Matches path pattern: /abc123/*                            │
│    - Routes to Target Group: openclaw-abc123                    │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Target Group                                                  │
│    - Health checks the registered targets                        │
│    - Forwards to healthy container IP:8080                      │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. ECS Task (Container)                                          │
│    - OpenClaw Gateway receives request on port 8080             │
│    - Processes chat request                                      │
│    - Uses secrets from AWS Secrets Manager:                     │
│      - OPENCLAW_GATEWAY_TOKEN                                   │
│      - ANTHROPIC_API_KEY                                        │
│    - Returns response                                           │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
Response flows back through ALB to user
```

---

## Instance Provisioning Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────────────────────────┐
│   Web App    │     │   Supabase   │     │              AWS                      │
│  (Next.js)   │     │  (Database)  │     │                                       │
└──────┬───────┘     └──────┬───────┘     └──────────────────┬───────────────────┘
       │                    │                                 │
       │  1. User clicks    │                                 │
       │     "Create        │                                 │
       │      Instance"     │                                 │
       │                    │                                 │
       ├────────────────────┼─────────────────────────────────┤
       │                    │                                 │
       │  2. Create         │                                 │
       │     instance       │                                 │
       │     record         │                                 │
       │ ──────────────────>│                                 │
       │                    │                                 │
       │  3. Call ECS       │                                 │
       │     Client         │                                 │
       │ ─────────────────────────────────────────────────────>
       │                    │                                 │
       │                    │     4. Create Secret            │
       │                    │        (gateway token,          │
       │                    │         API key)                │
       │                    │        ────────────────────────>│ Secrets Manager
       │                    │                                 │
       │                    │     5. Create Target Group      │
       │                    │        ────────────────────────>│ ALB
       │                    │                                 │
       │                    │     6. Create Listener Rule     │
       │                    │        (path: /abc123/*)        │
       │                    │        ────────────────────────>│ ALB
       │                    │                                 │
       │                    │     7. Create ECS Service       │
       │                    │        ────────────────────────>│ ECS
       │                    │                                 │
       │                    │     8. ECS schedules task       │
       │                    │        on available EC2         │
       │                    │        ────────────────────────>│ EC2
       │                    │                                 │
       │  9. Update         │                                 │
       │     instance       │                                 │
       │     with ARNs      │                                 │
       │ ──────────────────>│                                 │
       │                    │                                 │
       │  10. Return URL    │                                 │
       │ <──────────────────│                                 │
       │                    │                                 │
       │  http://alb-dns/abc123/                              │
       │                    │                                 │
```

---

## Cost Scaling

| Users | EC2 Instances | Tasks per Instance | Monthly Cost | Cost per User |
|-------|---------------|-------------------|--------------|---------------|
| 0 | 1 (on-demand base) | 0 | ~$57 | - |
| 1-2 | 1 | 1-2 | ~$57 | $28-57 |
| 3-4 | 1 | 3-4 | ~$57 | $14-19 |
| 5-8 | 2 | 4 each | ~$65 | $8-13 |
| 10-16 | 4 | 4 each | ~$80 | $5-8 |
| 50 | ~13 | 4 each | ~$150 | ~$3 |
| 100 | ~25 | 4 each | ~$250 | ~$2.50 |
| 500 | ~125 | 4 each | ~$630 | ~$1.26 |

**Note:** Costs assume Spot instances at ~70% discount. Fixed costs (ALB, NAT) remain constant.

---

## Security Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              Security Layers                                     │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                        Security Group: ALB                               │    │
│  │   Inbound:  80 (HTTP), 443 (HTTPS) from 0.0.0.0/0                       │    │
│  │   Outbound: All traffic                                                  │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                       │                                          │
│                                       ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                   Security Group: ECS Instances                          │    │
│  │   Inbound:  All traffic from ALB Security Group                         │    │
│  │   Outbound: All traffic (for NAT/internet access)                       │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                       │                                          │
│                                       ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                     Security Group: ECS Tasks                            │    │
│  │   Inbound:  8080 from ECS Instances Security Group                      │    │
│  │   Outbound: All traffic                                                  │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                          IAM Roles                                        │    │
│  │                                                                           │    │
│  │   Execution Role: openclaw-ecs-execution                                 │    │
│  │   - Pull images from ECR                                                 │    │
│  │   - Read secrets from Secrets Manager                                    │    │
│  │   - Write logs to CloudWatch                                             │    │
│  │                                                                           │    │
│  │   Task Role: openclaw-ecs-task                                           │    │
│  │   - (minimal permissions for container runtime)                          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                     Secrets Manager                                       │    │
│  │                                                                           │    │
│  │   Per-user secrets: openclaw/{instance-id}                               │    │
│  │   - OPENCLAW_GATEWAY_TOKEN                                               │    │
│  │   - ANTHROPIC_API_KEY                                                    │    │
│  │                                                                           │    │
│  │   Injected at container start, never exposed in logs or env vars         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Files Reference

| File | Purpose |
|------|---------|
| `infrastructure/terraform/*.tf` | Terraform configs for all AWS resources |
| `infrastructure/terraform/terraform.tfvars` | Environment-specific values |
| `infrastructure/Dockerfile` | Docker image for ECS tasks |
| `apps/web/src/lib/aws/ecs-client.ts` | TypeScript client for ECS provisioning |
| `apps/web/.env.local` | AWS configuration for web app |
| `supabase/migrations/002_aws_ecs_support.sql` | Database schema for AWS |

---

## Useful Commands

```bash
# Check cluster status
aws ecs describe-clusters --clusters openclaw-cluster --region us-west-2

# List running services
aws ecs list-services --cluster openclaw-cluster --region us-west-2

# List running tasks
aws ecs list-tasks --cluster openclaw-cluster --region us-west-2

# Check ASG instances
aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names openclaw-ecs-asg --region us-west-2

# View container logs
aws logs tail /ecs/openclaw --region us-west-2 --follow

# Get ALB DNS
terraform output alb_dns_name
```
