# Auto Scaling Group with Spot Instances for ECS

resource "aws_launch_template" "ecs_spot" {
  name_prefix   = "openclaw-ecs-"
  image_id      = data.aws_ami.ecs_optimized.id
  instance_type = var.instance_types[0]

  iam_instance_profile {
    arn = aws_iam_instance_profile.ecs_instance.arn
  }

  network_interfaces {
    # Use public IP when NAT gateway is disabled (instances in public subnets)
    associate_public_ip_address = !var.use_nat_gateway
    security_groups             = [aws_security_group.ecs_instances.id]
  }

  user_data = base64encode(<<-EOF
    #!/bin/bash
    echo "ECS_CLUSTER=${aws_ecs_cluster.openclaw.name}" >> /etc/ecs/ecs.config
    echo "ECS_ENABLE_SPOT_INSTANCE_DRAINING=true" >> /etc/ecs/ecs.config
  EOF
  )

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name = "openclaw-ecs-spot"
    }
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_autoscaling_group" "ecs_spot" {
  name                = "openclaw-ecs-asg"
  min_size            = var.asg_min_size
  max_size            = var.asg_max_size
  desired_capacity    = var.asg_desired_capacity
  # Use public subnets when NAT gateway is disabled, private subnets when enabled
  vpc_zone_identifier = var.use_nat_gateway ? aws_subnet.private[*].id : aws_subnet.public[*].id

  # Don't wait for instances to become healthy (Spot may take time)
  wait_for_capacity_timeout = "0"

  # Protect instances that are running tasks
  protect_from_scale_in = true

  mixed_instances_policy {
    instances_distribution {
      # Use 1 on-demand for base (more reliable for dev), rest can be Spot
      on_demand_base_capacity                  = 1
      on_demand_percentage_above_base_capacity = 0
      spot_allocation_strategy                 = "capacity-optimized"
    }

    launch_template {
      launch_template_specification {
        launch_template_id = aws_launch_template.ecs_spot.id
        version            = "$Latest"
      }

      dynamic "override" {
        for_each = var.instance_types
        content {
          instance_type = override.value
        }
      }
    }
  }

  tag {
    key                 = "Name"
    value               = "openclaw-ecs-spot"
    propagate_at_launch = true
  }

  tag {
    key                 = "AmazonECSManaged"
    value               = "true"
    propagate_at_launch = true
  }

  lifecycle {
    ignore_changes = [desired_capacity]
  }
}
