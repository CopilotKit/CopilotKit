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
  account_id = data.aws_caller_identity.current.account_id
  region     = data.aws_region.current.id

  app_name = "${var.stack_name_base}-frontend"
}

# =============================================================================
# S3 Bucket for Access Logs
# =============================================================================

resource "aws_s3_bucket" "access_logs" {
  bucket_prefix = "${lower(var.stack_name_base)}-access-logs-"
  force_destroy = true


}

resource "aws_s3_bucket_public_access_block" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id

  rule {
    id     = "DeleteOldAccessLogs"
    status = "Enabled"

    expiration {
      days = var.access_logs_expiry_days
    }
  }
}

# =============================================================================
# S3 Bucket for Staging (Amplify Deployments)
# =============================================================================

resource "aws_s3_bucket" "staging" {
  bucket_prefix = "${lower(var.stack_name_base)}-staging-"
  force_destroy = true


}

resource "aws_s3_bucket_versioning" "staging" {
  bucket = aws_s3_bucket.staging.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "staging" {
  bucket = aws_s3_bucket.staging.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "staging" {
  bucket = aws_s3_bucket.staging.id

  rule {
    id     = "DeleteOldDeployments"
    status = "Enabled"

    expiration {
      days = var.staging_bucket_expiry_days
    }
  }
}

resource "aws_s3_bucket_logging" "staging" {
  bucket = aws_s3_bucket.staging.id

  target_bucket = aws_s3_bucket.access_logs.id
  target_prefix = "staging-bucket-access-logs/"
}

# Bucket policy: Allow Amplify service access
resource "aws_s3_bucket_policy" "staging" {
  bucket = aws_s3_bucket.staging.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AmplifyAccess"
        Effect = "Allow"
        Principal = {
          Service = "amplify.amazonaws.com"
        }
        Action = [
          "s3:GetObject",
          "s3:GetObjectVersion"
        ]
        Resource = "${aws_s3_bucket.staging.arn}/*"
      },
      {
        Sid       = "DenyInsecureConnections"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.staging.arn,
          "${aws_s3_bucket.staging.arn}/*"
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      }
    ]
  })
}

# =============================================================================
# Amplify App
# =============================================================================
# Note: This creates a manual deployment app (no Git integration)
# Frontend deployments are handled via the deploy-frontend.py script
# Environment variables are set at deployment time, not at app creation

resource "aws_amplify_app" "frontend" {
  name        = local.app_name
  platform    = var.platform
  description = "${var.stack_name_base} - React/Next.js Frontend"


}

# =============================================================================
# Amplify Branch (main)
# =============================================================================

resource "aws_amplify_branch" "main" {
  app_id      = aws_amplify_app.frontend.id
  branch_name = "main"
  stage       = "PRODUCTION"

  description = "Main production branch"

  # Enable auto-build on push (if using Git integration)
  enable_auto_build = false


}
