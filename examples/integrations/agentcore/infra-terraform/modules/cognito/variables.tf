# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

variable "stack_name_base" {
  description = "Base name for all resources."
  type        = string
}

variable "admin_user_email" {
  description = "Email address for the admin user. If provided, creates an admin user."
  type        = string
  default     = null
}

variable "amplify_url" {
  description = "Amplify app URL to add to callback URLs."
  type        = string
  default     = null
}
