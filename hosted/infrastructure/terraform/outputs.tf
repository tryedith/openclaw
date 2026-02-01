# Outputs for use in application configuration

output "ecr_repository_url" {
  description = "ECR repository URL for pushing Docker images"
  value       = aws_ecr_repository.openclaw.repository_url
}

output "ecs_cluster_name" {
  description = "Name of the ECS cluster"
  value       = aws_ecs_cluster.openclaw.name
}

output "ecs_cluster_arn" {
  description = "ARN of the ECS cluster"
  value       = aws_ecs_cluster.openclaw.arn
}

output "task_definition_arn" {
  description = "ARN of the base task definition"
  value       = aws_ecs_task_definition.openclaw.arn
}

output "task_definition_family" {
  description = "Family name of the task definition"
  value       = aws_ecs_task_definition.openclaw.family
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

output "private_subnet_ids" {
  description = "Private subnet IDs for ECS tasks"
  value       = aws_subnet.private[*].id
}

output "ecs_subnet_ids" {
  description = "Subnet IDs where ECS tasks run (public if NAT disabled, private if NAT enabled)"
  value       = var.use_nat_gateway ? aws_subnet.private[*].id : aws_subnet.public[*].id
}

output "ecs_tasks_security_group_id" {
  description = "Security group ID for ECS tasks"
  value       = aws_security_group.ecs_tasks.id
}

output "execution_role_arn" {
  description = "ARN of the ECS execution role"
  value       = aws_iam_role.ecs_execution.arn
}

output "task_role_arn" {
  description = "ARN of the ECS task role"
  value       = aws_iam_role.ecs_task.arn
}

# Environment variables to set in the web app
output "env_vars" {
  description = "Environment variables for the web application"
  value = {
    AWS_REGION            = var.aws_region
    ECS_CLUSTER_NAME      = aws_ecs_cluster.openclaw.name
    ECS_TASK_DEFINITION   = aws_ecs_task_definition.openclaw.family
    ALB_LISTENER_ARN      = var.enable_https ? aws_lb_listener.https[0].arn : aws_lb_listener.http.arn
    VPC_ID                = aws_vpc.main.id
    # Use public subnets when NAT is disabled, private when enabled
    SUBNET_IDS            = join(",", var.use_nat_gateway ? aws_subnet.private[*].id : aws_subnet.public[*].id)
    SECURITY_GROUP_ID     = aws_security_group.ecs_tasks.id
  }
}
