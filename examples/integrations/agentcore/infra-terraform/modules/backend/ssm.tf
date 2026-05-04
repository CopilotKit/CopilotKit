# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

# =============================================================================
# SSM Parameters & Secrets Manager
# Maps to: backend-stack.ts createRuntimeSSMParameters() + createCognitoSSMParameters()
# =============================================================================

# -----------------------------------------------------------------------------
# SSM Parameters
# Store configuration values for cross-stack references and frontend access
# -----------------------------------------------------------------------------

resource "aws_ssm_parameter" "runtime_arn" {
  name        = "${local.ssm_parameter_prefix}/runtime-arn"
  description = "AgentCore Runtime ARN"
  type        = "String"
  value       = aws_bedrockagentcore_agent_runtime.main.agent_runtime_arn

}

resource "aws_ssm_parameter" "cognito_user_pool_id" {
  name        = "${local.ssm_parameter_prefix}/cognito-user-pool-id"
  description = "Cognito User Pool ID"
  type        = "String"
  value       = var.user_pool_id

}

resource "aws_ssm_parameter" "cognito_user_pool_client_id" {
  name        = "${local.ssm_parameter_prefix}/cognito-user-pool-client-id"
  description = "Cognito User Pool Client ID"
  type        = "String"
  value       = var.web_client_id

}

resource "aws_ssm_parameter" "machine_client_id" {
  name        = "${local.ssm_parameter_prefix}/machine_client_id"
  description = "Machine Client ID for M2M authentication"
  type        = "String"
  value       = aws_cognito_user_pool_client.machine.id

}

resource "aws_ssm_parameter" "cognito_provider" {
  name        = "${local.ssm_parameter_prefix}/cognito_provider"
  description = "Cognito domain URL for token endpoint"
  type        = "String"
  value       = var.cognito_domain_url

}

resource "aws_ssm_parameter" "feedback_api_url" {
  name        = "${local.ssm_parameter_prefix}/feedback-api-url"
  description = "Feedback API Gateway URL"
  type        = "String"
  value       = "${aws_api_gateway_stage.prod.invoke_url}/feedback"

}

resource "aws_ssm_parameter" "copilotkit_runtime_url" {
  name        = "${local.ssm_parameter_prefix}/copilotkit-runtime-url"
  description = "CopilotKit runtime API URL"
  type        = "String"
  value       = "${aws_apigatewayv2_stage.copilotkit_runtime.invoke_url}/copilotkit"

}

resource "aws_ssm_parameter" "gateway_url" {
  name        = "${local.ssm_parameter_prefix}/gateway_url"
  description = "AgentCore Gateway URL"
  type        = "String"
  value       = aws_bedrockagentcore_gateway.main.gateway_url

}

# Agent Code Bucket (zip mode only) - matches CDK's AgentCodeBucketNameParam
resource "aws_ssm_parameter" "agent_code_bucket" {
  count = local.is_zip ? 1 : 0

  name        = "${local.ssm_parameter_prefix}/agent-code-bucket"
  description = "S3 bucket for agent code deployment packages"
  type        = "String"
  value       = aws_s3_bucket.agent_code[0].id

}

# -----------------------------------------------------------------------------
# Secrets Manager - Machine Client Secret
# Store the machine client secret securely
# -----------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "machine_client_secret" {
  name        = "${local.ssm_parameter_prefix}/machine_client_secret"
  description = "Machine Client Secret for M2M authentication"

}

resource "aws_secretsmanager_secret_version" "machine_client_secret" {
  secret_id     = aws_secretsmanager_secret.machine_client_secret.id
  secret_string = aws_cognito_user_pool_client.machine.client_secret
}
