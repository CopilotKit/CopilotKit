# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

# =============================================================================
# Cognito Outputs
# =============================================================================

output "cognito_user_pool_id" {
  description = "Cognito User Pool ID"
  value       = module.cognito.user_pool_id
}

output "cognito_web_client_id" {
  description = "Cognito Web Client ID (for frontend)"
  value       = module.cognito.web_client_id
}

output "cognito_machine_client_id" {
  description = "Cognito Machine Client ID (for M2M authentication)"
  value       = module.backend.machine_client_id
}

output "cognito_domain_url" {
  description = "Cognito domain URL for OAuth"
  value       = module.cognito.cognito_domain_url
}

# =============================================================================
# Amplify Outputs
# =============================================================================

output "amplify_app_id" {
  description = "Amplify App ID"
  value       = module.amplify_hosting.app_id
}

output "amplify_app_url" {
  description = "Amplify App URL (frontend)"
  value       = module.amplify_hosting.app_url
}

output "amplify_staging_bucket" {
  description = "S3 bucket for frontend staging deployments"
  value       = module.amplify_hosting.staging_bucket_name
}

# =============================================================================
# AgentCore Memory Outputs
# =============================================================================

output "memory_arn" {
  description = "AgentCore Memory ARN"
  value       = module.backend.memory_arn
}

# =============================================================================
# AgentCore Gateway Outputs
# =============================================================================

output "gateway_id" {
  description = "AgentCore Gateway ID"
  value       = module.backend.gateway_id
}

output "gateway_arn" {
  description = "AgentCore Gateway ARN"
  value       = module.backend.gateway_arn
}

output "gateway_url" {
  description = "AgentCore Gateway URL"
  value       = module.backend.gateway_url
}

output "gateway_target_id" {
  description = "AgentCore Gateway Target ID"
  value       = module.backend.gateway_target_id
}

output "tool_lambda_arn" {
  description = "Sample tool Lambda function ARN"
  value       = module.backend.tool_lambda_arn
}

# =============================================================================
# AgentCore Runtime Outputs
# =============================================================================

output "runtime_id" {
  description = "AgentCore Runtime ID"
  value       = module.backend.runtime_id
}

output "runtime_arn" {
  description = "AgentCore Runtime ARN"
  value       = module.backend.runtime_arn
}

output "runtime_role_arn" {
  description = "AgentCore Runtime execution role ARN"
  value       = module.backend.runtime_role_arn
}

output "copilotkit_runtime_url" {
  description = "CopilotKit runtime API URL"
  value       = module.backend.copilotkit_runtime_url
}

# =============================================================================
# SSM Parameter Paths (for reference)
# =============================================================================

output "ssm_parameter_prefix" {
  description = "SSM parameter prefix for this deployment"
  value       = local.ssm_parameter_prefix
}

# =============================================================================
# Summary Output
# =============================================================================

output "deployment_summary" {
  description = "Summary of deployed resources"
  value = {
    stack_name      = var.stack_name_base
    region          = local.region
    account_id      = local.account_id
    deployment_type = var.backend_deployment_type
    frontend_url    = module.amplify_hosting.app_url
    gateway_url     = module.backend.gateway_url
    copilotkit_url  = module.backend.copilotkit_runtime_url
  }
}
