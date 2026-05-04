# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

# =============================================================================
# Core Configuration
# =============================================================================

variable "stack_name_base" {
  description = "Base name for all resources."
  type        = string
}

variable "backend_pattern" {
  description = "Agent pattern to deploy."
  type        = string
  default     = "strands-single-agent"
}

variable "backend_deployment_type" {
  description = "Deployment type: 'docker' (container via ECR) or 'zip' (Python package via S3). Note: claude-agent-sdk patterns require 'docker'."
  type        = string
  default     = "docker"
}

variable "backend_network_mode" {
  description = "Network mode for AgentCore Runtime (PUBLIC or VPC)."
  type        = string
  default     = "PUBLIC"
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
  description = "List of subnet IDs for VPC network mode. Required when backend_network_mode is 'VPC'."
  type        = list(string)
  default     = []
}

variable "backend_vpc_security_group_ids" {
  description = "List of security group IDs for VPC network mode. Optional when backend_network_mode is 'VPC'. If omitted, a default security group is created."
  type        = list(string)
  default     = []
}

# =============================================================================
# Cognito Configuration (passed from cognito module)
# =============================================================================

variable "user_pool_id" {
  description = "Cognito User Pool ID."
  type        = string
}

variable "user_pool_arn" {
  description = "Cognito User Pool ARN."
  type        = string
}

variable "web_client_id" {
  description = "Cognito Web Client ID (for frontend OAuth)."
  type        = string
}

# =============================================================================
# Amplify Configuration (passed from amplify module)
# =============================================================================

variable "frontend_url" {
  description = "Frontend URL for CORS and callback configuration."
  type        = string
}

variable "cognito_domain_url" {
  description = "Cognito domain URL for OAuth token endpoint."
  type        = string
}

# =============================================================================
# Optional Configuration
# =============================================================================

variable "container_uri" {
  description = "Container image URI. If not provided, ECR repository will be created."
  type        = string
  default     = null
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days."
  type        = number
  default     = 7
}

variable "throttling_rate_limit" {
  description = "API Gateway throttling rate limit."
  type        = number
  default     = 100
}

variable "throttling_burst_limit" {
  description = "API Gateway throttling burst limit."
  type        = number
  default     = 200
}

