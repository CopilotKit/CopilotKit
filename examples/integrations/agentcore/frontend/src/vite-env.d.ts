// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_COGNITO_USER_POOL_ID?: string
  readonly VITE_COGNITO_CLIENT_ID?: string
  readonly VITE_COGNITO_REGION?: string
  readonly VITE_COGNITO_REDIRECT_URI?: string
  readonly VITE_COGNITO_POST_LOGOUT_REDIRECT_URI?: string
  readonly VITE_COGNITO_RESPONSE_TYPE?: string
  readonly VITE_COGNITO_SCOPE?: string
  readonly VITE_COGNITO_AUTOMATIC_SILENT_RENEW?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
