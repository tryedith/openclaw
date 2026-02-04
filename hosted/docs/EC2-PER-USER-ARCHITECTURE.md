# OpenClaw Hosted Platform - EC2 Per User Architecture

## Overview

Each user gets their own dedicated EC2 Spot instance running Docker directly. A pool of pre-initialized instances (N+2) enables instant user assignment.

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
│  │                       Instance Pool                                   │  │
│  │                                                                       │  │
│  │   User A Instance      User B Instance      Spare Instances (N+2)    │  │
│  │   t3.small (2GB)       t3.small (2GB)       t3.small (2GB)           │  │
│  │   ┌─────────────┐      ┌─────────────┐      ┌─────────────┐          │  │
│  │   │   Docker    │      │   Docker    │      │   Docker    │          │  │
│  │   │  Container  │      │  Container  │      │   Ready     │          │  │
│  │   │  (OpenClaw) │      │  (OpenClaw) │      │ to assign   │          │  │
│  │   └─────────────┘      └─────────────┘      └─────────────┘          │  │
│  │   Status: assigned     Status: assigned     Status: available        │  │
│  │   UserId: user-123     UserId: user-456                              │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │ Secrets Manager │  │   ECR Repo      │  │  SSM (for       │             │
│  │ (per-user       │  │   (openclaw     │  │   remote cmd)   │             │
│  │  credentials)   │  │    image)       │  │                 │             │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘             │
│                                                                             │
│  NO NAT Gateway - instances in public subnets with public IPs              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Key Differences from ECS Architecture

| Aspect | ECS Architecture | EC2 Per User |
|--------|------------------|--------------|
| **Isolation** | Shared instances | Dedicated instance per user |
| **Provisioning** | 2-4 min (scale-up) | ~10-30 sec (from pool) |
| **NAT Gateway** | Required ($37/mo) | Not needed ($0) |
| **Complexity** | High (ECS concepts) | Low (just EC2 + Docker) |
| **Cost (10 users)** | ~$122/month | ~$83/month |

## Components

### Instance Pool

Pre-launched EC2 instances ready for user assignment:

- **Instance Type**: `t3.small` (2 vCPU, 2GB RAM)
- **Spot Pricing**: ~$0.006/hr (~$4.38/month)
- **Pool Strategy**: N+2 (always keep 2 spare instances)
- **AMI**: Amazon Linux 2023 with Docker pre-installed

### Instance States

| State | Description |
|-------|-------------|
| `initializing` | Instance launching, Docker installing |
| `available` | Ready to assign to a user |
| `assigned` | Running a user's container |
| `terminating` | Being shut down |

### Networking

- **Subnets**: Public subnets (no NAT needed)
- **Public IP**: Enabled on instances
- **Security Group**: Allow 8080 from ALB only
- **Docker Networking**: Bridge mode (uses host's public IP)

## User Deployment Flow

```
1. User creates instance via Web UI
   ↓
2. Get available instance from pool
   (Tag: Status=available)
   ↓
3. Create secret in Secrets Manager
   ↓
4. Start container via SSM Run Command
   - Pull image from ECR
   - Inject secrets as env vars
   - Run container with --restart=always
   ↓
5. Tag instance as assigned
   (Status=assigned, UserId=xxx)
   ↓
6. Create ALB Target Group
   ↓
7. Register instance with Target Group
   ↓
8. Create ALB Listener Rule
   ↓
9. Replenish pool (launch new spare)
   ↓
Done! (~10-30 seconds total)
```

## User Deletion Flow

```
1. User deletes instance via Web UI
   ↓
2. Deregister from ALB Target Group
   ↓
3. Delete ALB Listener Rule
   ↓
4. Delete Target Group
   ↓
5. Terminate EC2 instance
   ↓
6. Delete secret from Secrets Manager
   ↓
7. Replenish pool (launch new spare)
```

## Configuration

### Terraform Variables

```hcl
variable "user_instance_type" {
  description = "EC2 instance type for user instances"
  type        = string
  default     = "t3.small"
}

variable "pool_spare_count" {
  description = "Number of spare instances to keep ready"
  type        = number
  default     = 2
}
```

### Environment Variables (Web App)

```bash
# Instance Pool
USER_INSTANCE_TYPE=t3.small
POOL_SPARE_COUNT=2
LAUNCH_TEMPLATE_ID=lt-xxxxxxxxx

# AWS
AWS_REGION=us-west-2
VPC_ID=vpc-xxxxxxxxx
SUBNET_IDS=subnet-xxx,subnet-yyy
SECURITY_GROUP_ID=sg-xxxxxxxxx
ALB_LISTENER_ARN=arn:aws:elasticloadbalancing:...

# ECR
ECR_REPOSITORY_URL=123456789.dkr.ecr.us-west-2.amazonaws.com/openclaw
```

## Cost Breakdown (10 Users + 2 Spare)

| Component | Monthly Cost |
|-----------|-------------|
| EC2 Spot (12 × t3.small) | $52.56 |
| ALB | $22.00 |
| Secrets Manager | $4.50 |
| CloudWatch Logs | $3.00 |
| ECR | $1.00 |
| **Total** | **~$83/month** |
| **Per User** | **~$8.30** |

### Cost Comparison

| Users | ECS Architecture | EC2 Per User | Savings |
|-------|-----------------|--------------|---------|
| 10 | $122/month | $83/month | $39 (32%) |
| 25 | $180/month | $140/month | $40 (22%) |
| 50 | $280/month | $230/month | $50 (18%) |

## Key Files

| File | Description |
|------|-------------|
| `terraform/ec2-per-user.tf` | Launch template, security group |
| `terraform/variables.tf` | Configuration variables |
| `terraform/iam.tf` | Instance role (SSM, Secrets, ECR) |
| `web/src/lib/aws/ec2-pool.ts` | Pool management class |
| `web/src/lib/aws/instance-client.ts` | User deployment logic |

## Security

### Instance Security Group

```hcl
ingress {
  from_port       = 8080
  to_port         = 8080
  protocol        = "tcp"
  security_groups = [aws_security_group.alb.id]  # ALB only
}

egress {
  from_port   = 0
  to_port     = 0
  protocol    = "-1"
  cidr_blocks = ["0.0.0.0/0"]  # Internet access
}
```

### IAM Instance Role

```json
{
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:*:*:secret:openclaw/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ec2:CreateTags"
      ],
      "Resource": "arn:aws:ec2:*:*:instance/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ssm:UpdateInstanceInformation",
        "ssmmessages:*",
        "ec2messages:*"
      ],
      "Resource": "*"
    }
  ]
}
```

## Monitoring

### CloudWatch Metrics

- **Instance Pool Size**: Available instances count
- **Assignment Latency**: Time from request to container running
- **Container Health**: Docker container status per instance

### Alarms

- Pool depleted (available < 1)
- Instance launch failures
- Container crash loops

## Troubleshooting

### Check Instance Status

```bash
aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=openclaw-user-instance" \
  --query 'Reservations[].Instances[].{ID:InstanceId,Status:Tags[?Key==`Status`].Value|[0],User:Tags[?Key==`UserId`].Value|[0]}'
```

### Check Container on Instance

```bash
aws ssm start-session --target i-xxxxxxxxx
# Then on instance:
docker ps
docker logs openclaw-gateway
```

### Replenish Pool Manually

```bash
aws ec2 run-instances \
  --launch-template LaunchTemplateId=lt-xxxxxxxxx \
  --count 1
```

## Migration from ECS

1. Deploy new EC2 pool infrastructure (parallel to ECS)
2. New users automatically get EC2 instances
3. Schedule maintenance window for existing users
4. Migrate existing users one by one
5. Decommission ECS infrastructure (cluster, ASG, capacity provider)
6. Remove NAT Gateway (saves $37/month)
