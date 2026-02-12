# Outputs for use in application configuration

output "ecr_repository_url" {
  description = "ECR repository URL for pushing Docker images"
  value       = aws_ecr_repository.openclaw.repository_url
}

output "alb_dns_name" {
  description = "DNS name of the Application Load Balancer"
  value       = aws_lb.openclaw.dns_name
}

output "alb_zone_id" {
  description = "Zone ID of the ALB for Route53 alias records"
  value       = aws_lb.openclaw.zone_id
}

output "alb_listener_arn" {
  description = "ARN of the listener for adding rules (HTTP or HTTPS)"
  value       = var.enable_https ? aws_lb_listener.https[0].arn : aws_lb_listener.http.arn
}

output "vpc_id" {
  description = "VPC ID for target group creation"
  value       = aws_vpc.main.id
}

output "public_subnet_ids" {
  description = "Public subnet IDs for EC2 instances"
  value       = aws_subnet.public[*].id
}

# Environment variables to set in the web app
output "env_vars" {
  description = "Environment variables for the web application"
  value = {
    AWS_REGION         = var.aws_region
    ALB_LISTENER_ARN   = var.enable_https ? aws_lb_listener.https[0].arn : aws_lb_listener.http.arn
    ALB_DNS_NAME       = aws_lb.openclaw.dns_name
    VPC_ID             = aws_vpc.main.id
    SUBNET_IDS         = join(",", aws_subnet.public[*].id)
    SECURITY_GROUP_ID  = aws_security_group.user_instances.id
    LAUNCH_TEMPLATE_ID = aws_launch_template.user_instance.id
    ECR_REPOSITORY_URL = aws_ecr_repository.openclaw.repository_url
  }
}
