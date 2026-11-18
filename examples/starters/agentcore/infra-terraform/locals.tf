# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

# =============================================================================
# Data Sources
# =============================================================================

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# =============================================================================
# Local Values
# =============================================================================

locals {
  # Account and region information
  account_id = data.aws_caller_identity.current.account_id
  region     = data.aws_region.current.id

  # Common tags applied to all resources via provider default_tags
  common_tags = {
    Project    = var.stack_name_base
    ManagedBy  = "Terraform"
    Repository = "fullstack-agentcore-solution-template"
  }

  # SSM parameter paths
  ssm_parameter_prefix = "/${var.stack_name_base}"

  # Log retention in days
  log_retention_days = 7

  # S3 lifecycle rules
  staging_bucket_expiry_days = 30
  access_logs_expiry_days    = 90

  # API Gateway settings
  api_throttling_rate_limit  = 100
  api_throttling_burst_limit = 200

}
