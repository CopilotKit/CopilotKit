// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import "@copilotkit/react-core/v2/styles.css"
import { useEffect, useState } from "react"
import { CopilotKitProvider } from "@copilotkit/react-core/v2"
import { useAuth as useOidcAuth } from "react-oidc-context"
import { loadAwsConfig, type AwsExportsConfig } from "@/lib/runtime-config"
import { CopilotKitChat } from "./CopilotKitChat"

export default function CopilotChatInterface() {
  const auth = useOidcAuth()
  const [config, setConfig] = useState<AwsExportsConfig | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    async function resolveConfig() {
      try {
        const runtimeConfig = await loadAwsConfig()
        if (!isMounted) return

        if (!runtimeConfig || !runtimeConfig.copilotKitRuntimeUrl) {
          throw new Error("CopilotKit runtime URL not found in configuration")
        }

        setConfig(runtimeConfig)
      } catch (err) {
        if (!isMounted) return
        const message = err instanceof Error ? err.message : "Unknown error"
        setError(`Configuration error: ${message}`)
      }
    }

    resolveConfig()
    return () => {
      isMounted = false
    }
  }, [])

  if (error) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-red-600">
        {error}
      </div>
    )
  }

  if (!config) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm">
        Loading CopilotKit configuration...
      </div>
    )
  }

  const accessToken = auth.user?.access_token ?? auth.user?.id_token

  return (
    <div className="h-full bg-[#f5f7fb]">
      <CopilotKitProvider
        runtimeUrl={config.copilotKitRuntimeUrl}
        headers={accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined}
      >
        <CopilotKitChat />
      </CopilotKitProvider>
    </div>
  )
}
