# ECS Cluster with Spot Capacity Provider

resource "aws_ecs_cluster" "openclaw" {
  name = "openclaw-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Name = "openclaw-cluster"
  }
}

# Capacity Provider for Spot instances
resource "aws_ecs_capacity_provider" "spot" {
  name = "openclaw-spot"

  auto_scaling_group_provider {
    auto_scaling_group_arn         = aws_autoscaling_group.ecs_spot.arn
    managed_termination_protection = "ENABLED"

    managed_scaling {
      status                    = "ENABLED"
      target_capacity           = 100
      minimum_scaling_step_size = 1
      maximum_scaling_step_size = 10
    }
  }
}

# Associate capacity provider with cluster
resource "aws_ecs_cluster_capacity_providers" "openclaw" {
  cluster_name = aws_ecs_cluster.openclaw.name

  capacity_providers = [aws_ecs_capacity_provider.spot.name]

  default_capacity_provider_strategy {
    capacity_provider = aws_ecs_capacity_provider.spot.name
    weight            = 100
    base              = 1
  }
}

# CloudWatch Log Group for ECS
# Note: Log group is created manually to avoid logs:TagResource permission issues
# Created via: aws logs create-log-group --log-group-name /ecs/openclaw --region us-west-2
# The task definition references this log group name directly
