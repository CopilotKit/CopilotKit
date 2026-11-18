# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

# =============================================================================
# Machine-to-Machine (M2M) Authentication
# Maps to: backend-stack.ts createMachineAuthentication()
# =============================================================================

# Resource Server for M2M Authentication
# Defines API scopes that machine clients can request access to

resource "aws_cognito_resource_server" "gateway" {
  identifier   = "${var.stack_name_base}-gateway"
  name         = "${var.stack_name_base}-gateway-resource-server"
  user_pool_id = var.user_pool_id

  scope {
    scope_name        = "read"
    scope_description = "Read access to gateway"
  }

  scope {
    scope_name        = "write"
    scope_description = "Write access to gateway"
  }
}

# Machine Client for AgentCore Gateway authentication
# Uses OAuth2 Client Credentials flow for service-to-service auth

resource "aws_cognito_user_pool_client" "machine" {
  name         = "${var.stack_name_base}-machine-client"
  user_pool_id = var.user_pool_id

  # Secret required for client credentials flow
  generate_secret = true

  # OAuth configuration for M2M
  allowed_oauth_flows                  = ["client_credentials"]
  allowed_oauth_flows_user_pool_client = true

  # Resource server scopes
  allowed_oauth_scopes = [
    "${aws_cognito_resource_server.gateway.identifier}/read",
    "${aws_cognito_resource_server.gateway.identifier}/write"
  ]

  # Supported identity providers
  supported_identity_providers = ["COGNITO"]

  # Token validity for M2M
  access_token_validity = 1

  token_validity_units {
    access_token = "hours"
  }

  depends_on = [aws_cognito_resource_server.gateway]
}
