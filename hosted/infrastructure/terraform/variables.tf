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

# EC2 Per User Configuration
variable "user_instance_type" {
  description = "EC2 instance type for dedicated user instances"
  type        = string
  default     = "t3.small"  # 2GB RAM, 2 vCPU
}

variable "user_instance_spot_price" {
  description = "Maximum spot price per hour for user instances (USD)"
  type        = string
  default     = "0.01"  # t3.small spot is typically ~$0.006/hr
}

variable "pool_spare_count" {
  description = "Number of spare instances to keep ready in the pool"
  type        = number
  default     = 2
}
