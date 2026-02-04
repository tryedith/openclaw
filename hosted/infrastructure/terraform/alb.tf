# Application Load Balancer for routing to user EC2 instances

resource "aws_lb" "openclaw" {
  name               = "openclaw-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id

  enable_deletion_protection = false

  tags = {
    Name = "openclaw-alb"
  }
}

# HTTP listener - main listener for dev, redirects to HTTPS in prod
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.openclaw.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = var.enable_https ? "redirect" : "fixed-response"

    dynamic "redirect" {
      for_each = var.enable_https ? [1] : []
      content {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }

    dynamic "fixed_response" {
      for_each = var.enable_https ? [] : [1]
      content {
        content_type = "text/plain"
        message_body = "OpenClaw - Instance not found"
        status_code  = "404"
      }
    }
  }
}

# HTTPS listener - only created if certificate is provided
resource "aws_lb_listener" "https" {
  count = var.enable_https ? 1 : 0

  load_balancer_arn = aws_lb.openclaw.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "OpenClaw - Instance not found"
      status_code  = "404"
    }
  }
}

# Note: Target groups and listener rules are created dynamically
# by the instance client when provisioning user EC2 instances
