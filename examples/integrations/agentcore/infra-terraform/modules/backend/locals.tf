# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

# =============================================================================
# Data Sources (shared across all backend resources)
# =============================================================================

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# =============================================================================
# Local Values
# =============================================================================

locals {
  account_id = data.aws_caller_identity.current.account_id
  region     = data.aws_region.current.id

  # Normalized stack name (lowercase, hyphens only)
  stack_name_normalized = lower(replace(var.stack_name_base, "_", "-"))

  # Stack name for resource naming (underscores for some AWS resources)
  stack_name_underscore = replace(var.stack_name_base, "-", "_")

  # Agent name used in runtime naming
  agent_name = "FASTAgent"

  # Runtime name (underscores required by AgentCore)
  runtime_name = "${local.stack_name_underscore}_${local.agent_name}"

  # Memory name (unique within account/region)
  # Must match ^[a-zA-Z][a-zA-Z0-9_]{0,47}$ - no hyphens allowed
  memory_name = "${local.stack_name_underscore}_memory"

  # OIDC discovery URL for Cognito JWT authorizer
  oidc_discovery_url = "https://cognito-idp.${local.region}.amazonaws.com/${var.user_pool_id}/.well-known/openid-configuration"

  # Lambda Powertools layer ARN (region-specific, Python 3.13, ARM64)
  powertools_layer_arn = "arn:aws:lambda:${local.region}:017000801446:layer:AWSLambdaPowertoolsPythonV3-python313-arm64:18"

  # Deployment type flags
  is_docker = var.backend_deployment_type == "docker"
  is_zip    = var.backend_deployment_type == "zip"

  # Pattern flags
  is_claude_agent_sdk = contains(["claude-agent-sdk-single-agent", "claude-agent-sdk-multi-agent"], var.backend_pattern)

  # Project paths (for zip packaging)
  project_root = "${path.module}/../../.."
  pattern_dir  = "${local.project_root}/patterns/${var.backend_pattern}"

  # Zip deployment configuration
  zip_entry_point                 = ["opentelemetry-instrument", "basic_agent.py"]
  zip_packager_lambda_source_path = "${path.module}/../../lambdas/zip-packager"

  # Lambda source paths
  feedback_lambda_source_path = "${path.module}/../../../infra-cdk/lambdas/feedback"
  copilotkit_runtime_source_path = "${path.module}/../../../infra-cdk/lambdas/copilotkit-runtime"

  # SSM parameter paths
  ssm_parameter_prefix = "/${var.stack_name_base}"

  # Log retention in days
  log_retention_days = var.log_retention_days

  # API Gateway settings
  api_throttling_rate_limit  = var.throttling_rate_limit
  api_throttling_burst_limit = var.throttling_burst_limit
  api_cache_ttl_seconds      = 300

  # Memory event expiry (hardcoded in CDK backend-stack.ts)
  memory_event_expiry_days = 30
}
