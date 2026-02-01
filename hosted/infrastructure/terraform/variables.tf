variable "aws_region" {
  description = "AWS region for resources"
  type        = string
  default     = "us-west-2"
}

variable "environment" {
  description = "Environment name (e.g., production, staging)"
  type        = string
  default     = "production"
}

variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "domain_name" {
  description = "Domain name for OpenClaw instances (optional for dev)"
  type        = string
  default     = ""
}

variable "acm_certificate_arn" {
  description = "ARN of ACM certificate for HTTPS (optional for dev)"
  type        = string
  default     = ""
}

variable "enable_https" {
  description = "Enable HTTPS listener (requires acm_certificate_arn)"
  type        = bool
  default     = false
}

variable "spot_max_price" {
  description = "Maximum spot price per hour (USD)"
  type        = string
  default     = "0.02"
}

variable "asg_min_size" {
  description = "Minimum number of EC2 instances in ASG"
  type        = number
  default     = 1
}

variable "asg_max_size" {
  description = "Maximum number of EC2 instances in ASG"
  type        = number
  default     = 20
}

variable "asg_desired_capacity" {
  description = "Desired number of EC2 instances in ASG"
  type        = number
  default     = 2
}

variable "instance_types" {
  description = "List of EC2 instance types for Spot fleet"
  type        = list(string)
  default     = ["t3.medium", "t3a.medium"]
}

variable "task_cpu" {
  description = "CPU units for ECS task (1024 = 1 vCPU)"
  type        = number
  default     = 512
}

variable "task_memory" {
  description = "Memory for ECS task in MB"
  type        = number
  default     = 1024
}

variable "use_nat_gateway" {
  description = "Use NAT Gateway for private subnet internet access (more secure, +$32/mo). If false, tasks run in public subnets."
  type        = bool
  default     = false
}
