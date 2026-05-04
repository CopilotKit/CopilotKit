# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

# =============================================================================
# Required Variables
# =============================================================================

variable "stack_name_base" {
  description = "Base name for all resources. Used as prefix for resource naming."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,34}$", var.stack_name_base))
    error_message = "Stack name must start with a lowercase letter, be 3-35 characters, and contain only lowercase alphanumeric characters and hyphens."
  }
}

# =============================================================================
# Optional Variables - Admin User
# =============================================================================

variable "admin_user_email" {
  description = "Email address for the admin user. If provided, creates an admin user and sends credentials via email. Set to null to skip admin user creation."
  type        = string
  default     = null

  validation {
    condition     = var.admin_user_email == null || can(regex("^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$", var.admin_user_email))
    error_message = "Must be a valid email address or null."
  }
}

# =============================================================================
# Backend Configuration
# =============================================================================

variable "backend_pattern" {
  description = "Agent pattern to deploy. Available patterns: strands-single-agent, langgraph-single-agent, claude-agent-sdk-single-agent, claude-agent-sdk-multi-agent"
  type        = string
  default     = "strands-single-agent"

  validation {
    condition     = contains(["strands-single-agent", "langgraph-single-agent", "claude-agent-sdk-single-agent", "claude-agent-sdk-multi-agent"], var.backend_pattern)
    error_message = "Backend pattern must be one of: strands-single-agent, langgraph-single-agent, claude-agent-sdk-single-agent, claude-agent-sdk-multi-agent."
  }
}

variable "backend_deployment_type" {
  description = "Deployment type for AgentCore Runtime. 'docker' uses ECR container image (requires Docker + separate build step). 'zip' uses S3 Python package (no Docker required, single-step deploy)."
  type        = string
  default     = "docker"

  validation {
    condition     = contains(["docker", "zip"], var.backend_deployment_type)
    error_message = "Deployment type must be 'docker' or 'zip'."
  }
}

variable "backend_network_mode" {
  description = "Network mode for AgentCore Runtime. PUBLIC (default) uses public internet. VPC deploys into a user-provided VPC for private network isolation."
  type        = string
  default     = "PUBLIC"

  validation {
    condition     = contains(["PUBLIC", "VPC"], var.backend_network_mode)
    error_message = "Network mode must be 'PUBLIC' or 'VPC'."
  }
}

# =============================================================================
# VPC Configuration (Required if backend_network_mode = VPC)
# =============================================================================

variable "backend_vpc_id" {
  description = "VPC ID for VPC network mode. Required when backend_network_mode is 'VPC'."
  type        = string
  default     = null
}

variable "backend_vpc_subnet_ids" {
  description = "List of subnet IDs for VPC network mode. Required when backend_network_mode is 'VPC'. Subnets should be in at least two Availability Zones."
  type        = list(string)
  default     = []
}

variable "backend_vpc_security_group_ids" {
  description = "List of security group IDs for VPC network mode. Optional when backend_network_mode is 'VPC'. If omitted, a default security group is created with HTTPS self-referencing ingress and all-traffic egress."
  type        = list(string)
  default     = []
}

