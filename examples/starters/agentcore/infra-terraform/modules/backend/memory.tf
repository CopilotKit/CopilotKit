# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

# =============================================================================
# AgentCore Memory
# Maps to: backend-stack.ts createAgentCoreRuntime() - memory section
# =============================================================================

# IAM Role for Memory Execution
# Role assumed by AgentCore Memory service for processing operations

data "aws_iam_policy_document" "memory_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["bedrock-agentcore.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "memory_execution" {
  name               = "${var.stack_name_base}-memory-execution-role"
  assume_role_policy = data.aws_iam_policy_document.memory_assume_role.json
  description        = "Execution role for AgentCore Memory"
}

# Attach the AWS managed policy for Bedrock model inference
# Required for long-term memory strategies that use model processing
resource "aws_iam_role_policy_attachment" "memory_bedrock_policy" {
  role       = aws_iam_role.memory_execution.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonBedrockAgentCoreMemoryBedrockModelInferenceExecutionRolePolicy"
}

# Persistent memory resource for AI agent interactions
# Configured with short-term memory (conversation history) as default
resource "aws_bedrockagentcore_memory" "main" {
  name                  = local.memory_name
  event_expiry_duration = local.memory_event_expiry_days
  description           = "Short-term memory for ${var.stack_name_base} agent"

  # Memory execution role for model processing (required for long-term strategies)
  memory_execution_role_arn = aws_iam_role.memory_execution.arn

  tags = {
    Name = "${var.stack_name_base}_Memory"
  }
}
