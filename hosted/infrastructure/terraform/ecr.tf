# ECR Repository for OpenClaw Docker images

resource "aws_ecr_repository" "openclaw" {
  name                 = "openclaw"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name = "openclaw"
  }
}

# Lifecycle policy to keep only recent images
resource "aws_ecr_lifecycle_policy" "openclaw" {
  repository = aws_ecr_repository.openclaw.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 images"
        selection = {
          tagStatus     = "any"
          countType     = "imageCountMoreThan"
          countNumber   = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}
