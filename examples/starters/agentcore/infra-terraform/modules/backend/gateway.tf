# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

# =============================================================================
# AgentCore Gateway
# Maps to: backend-stack.ts createAgentCoreGateway()
# =============================================================================

# -----------------------------------------------------------------------------
# IAM Role for Gateway
# -----------------------------------------------------------------------------

data "aws_iam_policy_document" "gateway_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["bedrock-agentcore.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "gateway" {
  name               = "${var.stack_name_base}-gateway-role"
  assume_role_policy = data.aws_iam_policy_document.gateway_assume_role.json
  description        = "Role for AgentCore Gateway"

}

data "aws_iam_policy_document" "gateway_policy" {
  # Bedrock permissions (region-agnostic)
  statement {
    sid    = "BedrockInvoke"
    effect = "Allow"
    actions = [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream"
    ]
    resources = [
      "arn:aws:bedrock:*::foundation-model/*",
      "arn:aws:bedrock:*:${local.account_id}:inference-profile/*"
    ]
  }

  # SSM parameter access
  statement {
    sid    = "SSMAccess"
    effect = "Allow"
    actions = [
      "ssm:GetParameter",
      "ssm:GetParameters"
    ]
    resources = ["arn:aws:ssm:${local.region}:${local.account_id}:parameter/${var.stack_name_base}/*"]
  }

  # Cognito permissions
  statement {
    sid    = "CognitoAccess"
    effect = "Allow"
    actions = [
      "cognito-idp:DescribeUserPoolClient",
      "cognito-idp:InitiateAuth"
    ]
    resources = [var.user_pool_arn]
  }

  # CloudWatch Logs
  statement {
    sid    = "CloudWatchLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]
    resources = ["arn:aws:logs:${local.region}:${local.account_id}:log-group:/aws/bedrock-agentcore/*"]
  }
}

resource "aws_iam_role_policy" "gateway" {
  name   = "${var.stack_name_base}-gateway-policy"
  role   = aws_iam_role.gateway.id
  policy = data.aws_iam_policy_document.gateway_policy.json
}

# -----------------------------------------------------------------------------
# Wait for IAM permission propagation
# -----------------------------------------------------------------------------

resource "time_sleep" "gateway_iam_propagation" {
  create_duration = "10s"

  depends_on = [aws_iam_role_policy.gateway]
}

# -----------------------------------------------------------------------------
# AgentCore Gateway
# -----------------------------------------------------------------------------

resource "aws_bedrockagentcore_gateway" "main" {
  name        = "${var.stack_name_base}-gateway"
  role_arn    = aws_iam_role.gateway.arn
  description = "AgentCore Gateway with MCP protocol and JWT authentication"

  protocol_type = "MCP"
  protocol_configuration {
    mcp {
      supported_versions = ["2025-03-26"]
    }
  }

  authorizer_type = "CUSTOM_JWT"
  authorizer_configuration {
    custom_jwt_authorizer {
      discovery_url   = local.oidc_discovery_url
      allowed_clients = [aws_cognito_user_pool_client.machine.id]
    }
  }

  depends_on = [time_sleep.gateway_iam_propagation]
}
