# EC2 Per User Infrastructure
# Each user gets their own dedicated EC2 Spot instance

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
        # Secrets Manager access for user credentials
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
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
  name_prefix   = "openclaw-user-"
  image_id      = data.aws_ami.amazon_linux_2023.id
  instance_type = var.user_instance_type

  iam_instance_profile {
    arn = aws_iam_instance_profile.user_instance.arn
  }

  network_interfaces {
    associate_public_ip_address = true  # Public IP, no NAT needed
    security_groups             = [aws_security_group.user_instances.id]
  }

  # Install Docker and signal ready
  user_data = base64encode(<<-EOF
    #!/bin/bash
    set -e

    # Get instance ID
    INSTANCE_ID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id)
    REGION=$(curl -s http://169.254.169.254/latest/meta-data/placement/region)

    # Install Docker
    yum update -y
    yum install -y docker jq
    systemctl enable docker
    systemctl start docker

    # Add ec2-user to docker group
    usermod -aG docker ec2-user

    # Install SSM agent (should be pre-installed, but ensure it's running)
    systemctl enable amazon-ssm-agent
    systemctl start amazon-ssm-agent

    # Login to ECR (so image is cached for faster startup)
    aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin ${data.aws_caller_identity.current.account_id}.dkr.ecr.$REGION.amazonaws.com

    # Pre-pull the image for faster container startup
    docker pull ${aws_ecr_repository.openclaw.repository_url}:latest || true

    # Signal instance is ready for assignment
    aws ec2 create-tags --region $REGION --resources $INSTANCE_ID --tags Key=Status,Value=available Key=Name,Value=openclaw-user-instance

    echo "Instance initialization complete"
  EOF
  )

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name   = "openclaw-user-instance"
      Status = "initializing"
    }
  }

  # Request Spot instances
  instance_market_options {
    market_type = "spot"
    spot_options {
      max_price                      = var.user_instance_spot_price
      instance_interruption_behavior = "terminate"
    }
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "optional"  # IMDSv1 for simpler scripting
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
