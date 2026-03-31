# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

variable "stack_name_base" {
  description = "Base name for all resources."
  type        = string
}

variable "platform" {
  description = "Platform type for Amplify app (WEB or WEB_COMPUTE)."
  type        = string
  default     = "WEB"
}

variable "staging_bucket_expiry_days" {
  description = "Number of days before staging bucket objects expire."
  type        = number
  default     = 30
}

variable "access_logs_expiry_days" {
  description = "Number of days before access log objects expire."
  type        = number
  default     = 90
}
