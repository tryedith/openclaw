# EC2 Per User Infrastructure
# Each user gets their own dedicated EC2 Spot instance

# Platform secret for shared credentials (API key)
resource "aws_secretsmanager_secret" "platform_credentials" {
  name        = "openclaw/platform-credentials"
  description = "Shared platform credentials for OpenClaw instances"

  tags = {
    Name = "openclaw-platform-credentials"
  }
}

# NOTE: You must manually set the secret value after deploy:
# aws secretsmanager put-secret-value --secret-id openclaw/platform-credentials \
#   --secret-string '{"ANTHROPIC_API_KEY":"sk-ant-xxx","OPENAI_API_KEY":"sk-proj-xxx","GEMINI_API_KEY":"AIza...","HOSTED_USAGE_REPORT_URL":"https://your-hosted-web-domain/api/usage/events","USAGE_SERVICE_KEY":"your-shared-secret"}'

# Get latest Amazon Linux 2023 AMI
data "aws_ami" "amazon_linux_2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# Security Group for user instances
resource "aws_security_group" "user_instances" {
  name        = "openclaw-user-instances"
  description = "Security group for OpenClaw user instances"
  vpc_id      = aws_vpc.main.id

  # Allow inbound from ALB only
  ingress {
    description     = "HTTP from ALB"
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  # Allow all outbound (for ECR, Secrets Manager, Anthropic API)
  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "openclaw-user-instances"
  }
}

# IAM Role for user instances
resource "aws_iam_role" "user_instance" {
  name = "openclaw-user-instance-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name = "openclaw-user-instance-role"
  }
}

# IAM Policy for user instances
resource "aws_iam_role_policy" "user_instance" {
  name = "openclaw-user-instance-policy"
  role = aws_iam_role.user_instance.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # ECR access for pulling images
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken",
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage"
        ]
        Resource = "*"
      },
      {
        # Secrets Manager access for user credentials and gateway tokens
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:CreateSecret",
          "secretsmanager:PutSecretValue",
          "secretsmanager:TagResource"
        ]
        Resource = "arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:openclaw/*"
      },
      {
        # EC2 tagging for status updates
        Effect = "Allow"
        Action = [
          "ec2:CreateTags",
          "ec2:DescribeTags"
        ]
        Resource = "*"
      },
      {
        # SSM for remote command execution
        Effect = "Allow"
        Action = [
          "ssm:UpdateInstanceInformation",
          "ssmmessages:CreateControlChannel",
          "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel",
          "ssmmessages:OpenDataChannel",
          "ec2messages:GetMessages",
          "ec2messages:SendReply"
        ]
        Resource = "*"
      },
      {
        # CloudWatch Logs
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogStreams"
        ]
        Resource = "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/openclaw/*"
      }
    ]
  })
}

# Instance Profile
resource "aws_iam_instance_profile" "user_instance" {
  name = "openclaw-user-instance-profile"
  role = aws_iam_role.user_instance.name
}

# Launch Template for user instances
resource "aws_launch_template" "user_instance" {
  name_prefix            = "openclaw-user-"
  image_id               = data.aws_ami.amazon_linux_2023.id
  instance_type          = var.user_instance_type
  update_default_version = true

  iam_instance_profile {
    arn = aws_iam_instance_profile.user_instance.arn
  }

  network_interfaces {
    associate_public_ip_address = true
    security_groups             = [aws_security_group.user_instances.id]
    subnet_id                   = aws_subnet.public[0].id
  }

  # Install Docker, start container, and signal ready
  user_data = base64encode(<<-EOF
    #!/bin/bash
    set -e

    # Get instance metadata (IMDSv2 - token required to prevent SSRF credential theft)
    IMDS_TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 300")
    INSTANCE_ID=$(curl -s -H "X-aws-ec2-metadata-token: $IMDS_TOKEN" http://169.254.169.254/latest/meta-data/instance-id)
    REGION=$(curl -s -H "X-aws-ec2-metadata-token: $IMDS_TOKEN" http://169.254.169.254/latest/meta-data/placement/region)

    # Install Docker and tools
    yum update -y
    yum install -y docker jq
    systemctl enable docker
    systemctl start docker
    usermod -aG docker ec2-user

    # Install SSM agent (should be pre-installed, but ensure it's running)
    systemctl enable amazon-ssm-agent
    systemctl start amazon-ssm-agent

    # Login to ECR
    aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin ${data.aws_caller_identity.current.account_id}.dkr.ecr.$REGION.amazonaws.com

    # Pull the image
    docker pull ${aws_ecr_repository.openclaw.repository_url}:latest

    # Generate unique gateway token for this instance
    GATEWAY_TOKEN=$(openssl rand -hex 32)

    # Store token in Secrets Manager (more secure than EC2 tags)
    aws secretsmanager create-secret --region $REGION \
      --name "openclaw/instance/$INSTANCE_ID/gateway-token" \
      --secret-string "$GATEWAY_TOKEN" \
      --tags Key=ManagedBy,Value=openclaw Key=InstanceId,Value=$INSTANCE_ID \
      || aws secretsmanager put-secret-value --region $REGION \
        --secret-id "openclaw/instance/$INSTANCE_ID/gateway-token" \
        --secret-string "$GATEWAY_TOKEN"

    # Fetch platform credentials
    SECRETS=$(aws secretsmanager get-secret-value --region $REGION \
      --secret-id openclaw/platform-credentials \
      --query SecretString --output text)
    ANTHROPIC_API_KEY=$(echo $SECRETS | jq -r .ANTHROPIC_API_KEY)
    OPENAI_API_KEY=$(echo $SECRETS | jq -r '.OPENAI_API_KEY // empty')
    GEMINI_API_KEY=$(echo $SECRETS | jq -r '.GEMINI_API_KEY // empty')
    HOSTED_USAGE_REPORT_URL=$(echo $SECRETS | jq -r '.HOSTED_USAGE_REPORT_URL // empty')
    USAGE_SERVICE_KEY=$(echo $SECRETS | jq -r '.USAGE_SERVICE_KEY // empty')

    # Start the container (pre-warmed and ready)
    docker run -d --name openclaw-gateway --restart=always -p 8080:8080 \
      -e OPENCLAW_GATEWAY_TOKEN="$GATEWAY_TOKEN" \
      -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
      -e OPENAI_API_KEY="$OPENAI_API_KEY" \
      -e GEMINI_API_KEY="$GEMINI_API_KEY" \
      -e HOSTED_USAGE_REPORT_URL="$HOSTED_USAGE_REPORT_URL" \
      -e USAGE_SERVICE_KEY="$USAGE_SERVICE_KEY" \
      -e OPENCLAW_CONFIG_PATH=/app/hosted-config.json \
      -e OPENCLAW_STATE_DIR=/tmp/.openclaw \
      -e PORT=8080 \
      -e NODE_ENV=production \
      ${aws_ecr_repository.openclaw.repository_url}:latest

    # Wait for container to be healthy before marking available
    for i in {1..60}; do
      if curl -sf http://localhost:8080/health > /dev/null 2>&1; then
        # Container is healthy - mark instance as available
        aws ec2 create-tags --region $REGION --resources $INSTANCE_ID \
          --tags Key=Status,Value=available Key=Name,Value=openclaw-user-instance
        echo "Instance ready and available for assignment"
        exit 0
      fi
      sleep 1
    done

    # If we get here, container failed to start
    echo "Container health check failed"
    docker logs openclaw-gateway --tail 30
    exit 1
  EOF
  )

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name   = "openclaw-user-instance"
      Status = "initializing"
    }
  }

  metadata_options {
    http_endpoint               = "enabled"
    instance_metadata_tags      = "enabled"
    http_tokens                 = "required" # IMDSv2 only - prevents SSRF credential theft
    http_put_response_hop_limit = 1
  }

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name = "openclaw-user-launch-template"
  }
}

# CloudWatch Log Group for user instances
resource "aws_cloudwatch_log_group" "user_instances" {
  name              = "/openclaw/user-instances"
  retention_in_days = 7

  tags = {
    Name = "openclaw-user-instances-logs"
  }
}

# Output the launch template ID for use in the web app
output "user_launch_template_id" {
  description = "Launch template ID for user instances"
  value       = aws_launch_template.user_instance.id
}

output "user_launch_template_version" {
  description = "Latest version of the launch template"
  value       = aws_launch_template.user_instance.latest_version
}

output "user_security_group_id" {
  description = "Security group ID for user instances"
  value       = aws_security_group.user_instances.id
}
