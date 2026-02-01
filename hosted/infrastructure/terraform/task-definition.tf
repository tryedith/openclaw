# Base ECS Task Definition for OpenClaw Gateway
# Note: Secrets are injected per-user via service creation overrides

resource "aws_ecs_task_definition" "openclaw" {
  family                   = "openclaw"
  requires_compatibilities = ["EC2"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name  = "gateway"
    image = "${aws_ecr_repository.openclaw.repository_url}:latest"

    essential = true

    portMappings = [{
      containerPort = 8080
      hostPort      = 8080
      protocol      = "tcp"
    }]

    environment = [
      { name = "PORT", value = "8080" },
      { name = "NODE_ENV", value = "production" },
      { name = "OPENCLAW_STATE_DIR", value = "/tmp/.openclaw" },
      { name = "OPENCLAW_CONFIG_PATH", value = "/app/hosted-config.json" },
    ]

    # Secrets are injected per-user via service creation
    # using containerOverrides.secrets with valueFrom pointing to
    # Secrets Manager ARN: openclaw/{instanceId}

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = "/ecs/openclaw"
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "gateway"
      }
    }

    healthCheck = {
      command     = ["CMD-SHELL", "curl -f http://localhost:8080/health || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 60
    }
  }])

  tags = {
    Name = "openclaw-task"
  }
}
