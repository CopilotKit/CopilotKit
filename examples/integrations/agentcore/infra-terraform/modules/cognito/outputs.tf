# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

# =============================================================================
# User Pool Outputs
# =============================================================================

output "user_pool_id" {
  description = "Cognito User Pool ID"
  value       = aws_cognito_user_pool.main.id
}

output "user_pool_arn" {
  description = "Cognito User Pool ARN"
  value       = aws_cognito_user_pool.main.arn
}

output "user_pool_endpoint" {
  description = "Cognito User Pool endpoint"
  value       = aws_cognito_user_pool.main.endpoint
}

# =============================================================================
# Web Client Outputs
# =============================================================================

output "web_client_id" {
  description = "Cognito Web Client ID (for frontend)"
  value       = aws_cognito_user_pool_client.web.id
}

# =============================================================================
# Domain Outputs
# =============================================================================

output "domain_name" {
  description = "Cognito domain name"
  value       = aws_cognito_user_pool_domain.main.domain
}

output "cognito_domain_url" {
  description = "Full Cognito domain URL for OAuth token endpoint"
  value       = "${aws_cognito_user_pool_domain.main.domain}.auth.${local.region}.amazoncognito.com"
}

# =============================================================================
# OIDC Configuration Outputs
# =============================================================================

output "oidc_issuer_url" {
  description = "OIDC issuer URL for JWT validation"
  value       = "https://cognito-idp.${local.region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
}

output "oidc_discovery_url" {
  description = "OIDC discovery URL (well-known configuration)"
  value       = "https://cognito-idp.${local.region}.amazonaws.com/${aws_cognito_user_pool.main.id}/.well-known/openid-configuration"
}

# =============================================================================
# Admin User Outputs
# =============================================================================

output "admin_user_created" {
  description = "Whether admin user was created"
  value       = var.admin_user_email != null
}
