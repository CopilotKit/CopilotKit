# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

# =============================================================================
# Memory Outputs
# =============================================================================

output "memory_arn" {
  description = "AgentCore Memory ARN"
  value       = aws_bedrockagentcore_memory.main.arn
}

# =============================================================================
# Gateway Outputs
# =============================================================================

output "gateway_id" {
  description = "AgentCore Gateway ID"
  value       = aws_bedrockagentcore_gateway.main.gateway_id
}

output "gateway_arn" {
  description = "AgentCore Gateway ARN"
  value       = aws_bedrockagentcore_gateway.main.gateway_arn
}

output "gateway_url" {
  description = "AgentCore Gateway URL"
  value       = aws_bedrockagentcore_gateway.main.gateway_url
}

output "gateway_target_id" {
  description = "AgentCore Gateway Target ID"
  value       = aws_bedrockagentcore_gateway_target.sample_tool.target_id
}

output "tool_lambda_arn" {
  description = "Sample tool Lambda function ARN"
  value       = aws_lambda_function.sample_tool.arn
}

# =============================================================================
# Runtime Outputs
# =============================================================================

output "runtime_id" {
  description = "AgentCore Runtime ID"
  value       = aws_bedrockagentcore_agent_runtime.main.agent_runtime_id
}

output "runtime_arn" {
  description = "AgentCore Runtime ARN"
  value       = aws_bedrockagentcore_agent_runtime.main.agent_runtime_arn
}

output "runtime_role_arn" {
  description = "AgentCore Runtime execution role ARN"
  value       = aws_iam_role.runtime.arn
}

output "copilotkit_runtime_url" {
  description = "CopilotKit runtime endpoint URL"
  value       = "${aws_apigatewayv2_stage.copilotkit_runtime.invoke_url}/copilotkit"
}

# =============================================================================
# Machine Client Outputs
# =============================================================================

output "machine_client_id" {
  description = "Cognito Machine Client ID (for M2M authentication)"
  value       = aws_cognito_user_pool_client.machine.id
}
