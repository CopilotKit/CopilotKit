# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

# =============================================================================
# Provider Configuration
# =============================================================================

provider "aws" {
  default_tags {
    tags = local.common_tags
  }
}

# =============================================================================
# DEPLOYMENT ORDER:
# 1. Amplify Hosting - Creates app and gets predictable URL
# 2. Cognito - Uses Amplify URL for callback URLs
# 3. Backend Resources (Memory, Gateway, Runtime, Feedback API)
# =============================================================================

# =============================================================================
# Module: Amplify Hosting (Frontend)
# =============================================================================
# Creates:
# - S3 bucket for access logs
# - S3 bucket for frontend staging
# - Amplify App (WEB platform)
# - Amplify Branch (main, PRODUCTION)

module "amplify_hosting" {
  source = "./modules/amplify-hosting"

  stack_name_base = var.stack_name_base

  staging_bucket_expiry_days = local.staging_bucket_expiry_days
  access_logs_expiry_days    = local.access_logs_expiry_days
}

# =============================================================================
# Module: Cognito (Authentication)
# =============================================================================
# Creates:
# - User Pool with password policy and invitation templates
# - User Pool Domain with managed login V2 branding
# - Web Client (for frontend OAuth)
# - Admin User (optional)

module "cognito" {
  source = "./modules/cognito"

  stack_name_base  = var.stack_name_base
  admin_user_email = var.admin_user_email

  # Use the predictable Amplify URL from the app_url output
  amplify_url = module.amplify_hosting.app_url

  depends_on = [module.amplify_hosting]
}

# =============================================================================
# Module: Backend (AgentCore + Feedback API)
# =============================================================================
# Creates:
# - AgentCore Memory (IAM role + memory resource)
# - M2M Authentication (resource server + machine client)
# - AgentCore Gateway (Lambda, IAM, gateway, target)
# - AgentCore Runtime (ECR, IAM, runtime)
# - Feedback API (DynamoDB, Lambda, API Gateway)
# - SSM Parameters & Secrets Manager

module "backend" {
  source = "./modules/backend"

  stack_name_base         = var.stack_name_base
  backend_pattern         = var.backend_pattern
  backend_deployment_type = var.backend_deployment_type
  backend_network_mode    = var.backend_network_mode

  # VPC configuration (for VPC mode)
  backend_vpc_id                 = var.backend_vpc_id
  backend_vpc_subnet_ids         = var.backend_vpc_subnet_ids
  backend_vpc_security_group_ids = var.backend_vpc_security_group_ids

  # Cognito configuration
  user_pool_id       = module.cognito.user_pool_id
  user_pool_arn      = module.cognito.user_pool_arn
  web_client_id      = module.cognito.web_client_id
  cognito_domain_url = module.cognito.cognito_domain_url

  # Frontend URL for CORS
  frontend_url = module.amplify_hosting.app_url

  # Optional overrides
  log_retention_days     = local.log_retention_days
  throttling_rate_limit  = local.api_throttling_rate_limit
  throttling_burst_limit = local.api_throttling_burst_limit

  depends_on = [module.cognito, module.amplify_hosting]
}
