# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

output "app_id" {
  description = "Amplify App ID"
  value       = aws_amplify_app.frontend.id
}

output "app_arn" {
  description = "Amplify App ARN"
  value       = aws_amplify_app.frontend.arn
}

output "default_domain" {
  description = "Amplify default domain"
  value       = aws_amplify_app.frontend.default_domain
}

output "app_url" {
  description = "Full Amplify app URL (main branch) - predictable format"
  value       = "https://main.${aws_amplify_app.frontend.id}.amplifyapp.com"
}

output "branch_name" {
  description = "Main branch name"
  value       = aws_amplify_branch.main.branch_name
}

output "staging_bucket_name" {
  description = "S3 staging bucket name for deployments"
  value       = aws_s3_bucket.staging.bucket
}

output "staging_bucket_arn" {
  description = "S3 staging bucket ARN"
  value       = aws_s3_bucket.staging.arn
}
