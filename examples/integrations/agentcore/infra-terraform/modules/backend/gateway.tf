# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

# =============================================================================
# AgentCore Gateway
# Maps to: backend-stack.ts createAgentCoreGateway()
# =============================================================================

# -----------------------------------------------------------------------------
# CloudWatch Log Group for Lambda
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "tool_lambda" {
  name              = "/aws/lambda/${var.stack_name_base}-sample-tool"
  retention_in_days = local.log_retention_days

}

# -----------------------------------------------------------------------------
# IAM Role for Lambda Function
# -----------------------------------------------------------------------------

data "aws_iam_policy_document" "tool_lambda_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "tool_lambda" {
  name               = "${var.stack_name_base}-sample-tool-lambda-role"
  assume_role_policy = data.aws_iam_policy_document.tool_lambda_assume_role.json
  description        = "Execution role for sample tool Lambda"

}

data "aws_iam_policy_document" "tool_lambda_policy" {
  statement {
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]
    resources = ["${aws_cloudwatch_log_group.tool_lambda.arn}:*"]
  }
}

resource "aws_iam_role_policy" "tool_lambda" {
  name   = "${var.stack_name_base}-sample-tool-lambda-policy"
  role   = aws_iam_role.tool_lambda.id
  policy = data.aws_iam_policy_document.tool_lambda_policy.json
}

# -----------------------------------------------------------------------------
# Lambda Function for Sample Tool
# -----------------------------------------------------------------------------

data "archive_file" "tool_lambda" {
  type        = "zip"
  source_dir  = local.gateway_lambda_source_path
  output_path = "${path.module}/artifacts/gateway_lambda.zip"
  excludes    = ["tool_spec.json", "__pycache__", "*.pyc"]
}

resource "aws_lambda_function" "sample_tool" {
  function_name = "${var.stack_name_base}-sample-tool"
  role          = aws_iam_role.tool_lambda.arn
  handler       = "sample_tool_lambda.handler"
  runtime       = "python3.13"
  timeout       = 30

  filename         = data.archive_file.tool_lambda.output_path
  source_code_hash = data.archive_file.tool_lambda.output_base64sha256

  depends_on = [aws_cloudwatch_log_group.tool_lambda]

}

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
  # Lambda invoke permission
  statement {
    sid    = "LambdaInvoke"
    effect = "Allow"
    actions = [
      "lambda:InvokeFunction"
    ]
    resources = [aws_lambda_function.sample_tool.arn]
  }

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
# Gateway Target creation can fail due to IAM role propagation delay
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

  # Protocol configuration
  protocol_type = "MCP"
  protocol_configuration {
    mcp {
      supported_versions = ["2025-03-26"]
    }
  }

  # JWT authorizer with Cognito - uses machine client from auth.tf
  authorizer_type = "CUSTOM_JWT"
  authorizer_configuration {
    custom_jwt_authorizer {
      discovery_url   = local.oidc_discovery_url
      allowed_clients = [aws_cognito_user_pool_client.machine.id]
    }
  }


  depends_on = [time_sleep.gateway_iam_propagation]
}

# -----------------------------------------------------------------------------
# AgentCore Gateway Target
# -----------------------------------------------------------------------------

resource "aws_bedrockagentcore_gateway_target" "sample_tool" {
  name               = "sample-tool-target"
  gateway_identifier = aws_bedrockagentcore_gateway.main.gateway_id
  description        = "Sample tool Lambda target"

  credential_provider_configuration {
    gateway_iam_role {}
  }

  target_configuration {
    mcp {
      lambda {
        lambda_arn = aws_lambda_function.sample_tool.arn

        tool_schema {
          inline_payload {
            name        = "text_analysis_tool"
            description = "A tool which analyzes an input block of text to count number of words and return the top N frequent characters."

            input_schema {
              type        = "object"
              description = "Input parameters for text analysis"

              property {
                name        = "text"
                type        = "string"
                description = "Input block of text to analyze"
                required    = true
              }

              property {
                name        = "N"
                type        = "integer"
                description = "The number of most frequent characters to return (optional, default = 5)"
              }
            }
          }
        }
      }
    }
  }

  depends_on = [aws_bedrockagentcore_gateway.main]
}
