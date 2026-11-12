# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

resource "aws_cloudwatch_log_group" "copilotkit_runtime" {
  name              = "/aws/lambda/${var.stack_name_base}-copilotkit-runtime"
  retention_in_days = local.log_retention_days
}

data "aws_ssm_parameter" "langgraph_runtime_arn" {
  name = "/langgraph-stack/runtime-arn"
}

data "aws_ssm_parameter" "strands_runtime_arn" {
  name = "/strands-stack/runtime-arn"
}

data "aws_iam_policy_document" "copilotkit_runtime_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "copilotkit_runtime" {
  name               = "${var.stack_name_base}-copilotkit-runtime-role"
  assume_role_policy = data.aws_iam_policy_document.copilotkit_runtime_assume_role.json
  description        = "Execution role for CopilotKit runtime Lambda"
}

data "aws_iam_policy_document" "copilotkit_runtime_policy" {
  statement {
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]
    resources = ["${aws_cloudwatch_log_group.copilotkit_runtime.arn}:*"]
  }
}

resource "aws_iam_role_policy" "copilotkit_runtime" {
  name   = "${var.stack_name_base}-copilotkit-runtime-policy"
  role   = aws_iam_role.copilotkit_runtime.id
  policy = data.aws_iam_policy_document.copilotkit_runtime_policy.json
}

resource "null_resource" "copilotkit_runtime_build" {
  triggers = {
    source_hash = sha256(join("", [
      for f in fileset(local.copilotkit_runtime_source_path, "**") :
      filesha256("${local.copilotkit_runtime_source_path}/${f}")
      if !endswith(f, "/")
    ]))
  }

  provisioner "local-exec" {
    command = <<-EOT
      set -e
      BUILD_DIR="${path.module}/artifacts/copilotkit_runtime_build"
      rm -rf "$BUILD_DIR"
      mkdir -p "$BUILD_DIR"
      cp -R ${local.copilotkit_runtime_source_path}/src "$BUILD_DIR/"
      cp ${local.copilotkit_runtime_source_path}/package.json "$BUILD_DIR/"
      cp ${local.copilotkit_runtime_source_path}/package-lock.json "$BUILD_DIR/"
      cp ${local.copilotkit_runtime_source_path}/tsconfig.json "$BUILD_DIR/"
      cd "$BUILD_DIR"
      npm ci --no-audit --no-fund
      npm run build
      npm prune --omit=dev
    EOT
  }
}

data "archive_file" "copilotkit_runtime" {
  type        = "zip"
  source_dir  = "${path.module}/artifacts/copilotkit_runtime_build"
  output_path = "${path.module}/artifacts/copilotkit_runtime.zip"
  excludes    = ["__pycache__", "*.pyc"]

  depends_on = [null_resource.copilotkit_runtime_build]
}

resource "aws_lambda_function" "copilotkit_runtime" {
  function_name = "${var.stack_name_base}-copilotkit-runtime"
  role          = aws_iam_role.copilotkit_runtime.arn
  handler       = "dist/index.handler"
  runtime       = "nodejs20.x"
  architectures = ["arm64"]
  timeout       = 30
  memory_size   = 1024

  filename         = data.archive_file.copilotkit_runtime.output_path
  source_code_hash = data.archive_file.copilotkit_runtime.output_base64sha256

  environment {
    variables = {
      AGENTCORE_AG_UI_URL         = "https://bedrock-agentcore.${local.region}.amazonaws.com/runtimes/${urlencode(var.backend_pattern == "strands-single-agent" ? data.aws_ssm_parameter.strands_runtime_arn.value : data.aws_ssm_parameter.langgraph_runtime_arn.value)}/invocations"
      COPILOTKIT_AGENT_NAME = var.backend_pattern
      LANGGRAPH_AGENTCORE_AG_UI_URL = "https://bedrock-agentcore.${local.region}.amazonaws.com/runtimes/${urlencode(data.aws_ssm_parameter.langgraph_runtime_arn.value)}/invocations"
      STRANDS_AGENTCORE_AG_UI_URL   = "https://bedrock-agentcore.${local.region}.amazonaws.com/runtimes/${urlencode(data.aws_ssm_parameter.strands_runtime_arn.value)}/invocations"
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.copilotkit_runtime,
    aws_iam_role_policy.copilotkit_runtime
  ]
}

resource "aws_apigatewayv2_api" "copilotkit_runtime" {
  name          = "${var.stack_name_base}-copilotkit-runtime-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_headers = ["content-type", "authorization"]
    allow_methods = ["GET", "OPTIONS", "POST"]
    allow_origins = [var.frontend_url, "http://localhost:3000"]
    max_age       = 300
  }
}

resource "aws_apigatewayv2_integration" "copilotkit_runtime" {
  api_id                 = aws_apigatewayv2_api.copilotkit_runtime.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.copilotkit_runtime.invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "copilotkit_runtime_root_get" {
  api_id    = aws_apigatewayv2_api.copilotkit_runtime.id
  route_key = "GET /copilotkit"
  target    = "integrations/${aws_apigatewayv2_integration.copilotkit_runtime.id}"
}

resource "aws_apigatewayv2_route" "copilotkit_runtime_root_post" {
  api_id    = aws_apigatewayv2_api.copilotkit_runtime.id
  route_key = "POST /copilotkit"
  target    = "integrations/${aws_apigatewayv2_integration.copilotkit_runtime.id}"
}

resource "aws_apigatewayv2_route" "copilotkit_runtime_proxy_get" {
  api_id    = aws_apigatewayv2_api.copilotkit_runtime.id
  route_key = "GET /copilotkit/{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.copilotkit_runtime.id}"
}

resource "aws_apigatewayv2_route" "copilotkit_runtime_proxy_post" {
  api_id    = aws_apigatewayv2_api.copilotkit_runtime.id
  route_key = "POST /copilotkit/{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.copilotkit_runtime.id}"
}

resource "aws_apigatewayv2_stage" "copilotkit_runtime" {
  api_id      = aws_apigatewayv2_api.copilotkit_runtime.id
  name        = "prod"
  auto_deploy = true
}

resource "aws_lambda_permission" "copilotkit_runtime" {
  statement_id  = "AllowCopilotKitRuntimeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.copilotkit_runtime.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.copilotkit_runtime.execution_arn}/*/*"
}
