"use client"
import { useAuth as useOidcAuth } from "react-oidc-context"
import { useEffect, useState } from "react"
import { WebStorageStateStore } from "oidc-client-ts"
import { createCognitoAuthConfig } from "@/lib/auth"

interface CognitoAuthConfig {
  authority?: string
  client_id?: string
  redirect_uri?: string
  post_logout_redirect_uri?: string
  response_type?: string
  scope?: string
  automaticSilentRenew?: boolean
  userStore?: WebStorageStateStore
}

export function useAuth() {
  const auth = useOidcAuth()
  const [authConfig, setAuthConfig] = useState<CognitoAuthConfig | null>(null)

  useEffect(() => {
    async function loadConfig() {
      try {
        const config = await createCognitoAuthConfig()
        setAuthConfig(config)
      } catch (error) {
        console.error("Failed to load auth configuration for signOut:", error)
      }
    }

    loadConfig()
  }, [])

  // If no AuthProvider context, return mock auth state (no authentication)
  if (!auth) {
    return {
      isAuthenticated: true,
      user: null,
      signIn: () => {},
      signOut: () => {},
      isLoading: false,
      error: null,
      token: null,
    }
  }

  return {
    isAuthenticated: auth.isAuthenticated,
    user: auth.user,
    signIn: auth.signinRedirect,
    signOut: () => {
      const clientId = authConfig?.client_id || import.meta.env.VITE_COGNITO_CLIENT_ID || ""
      const logoutUri =
        authConfig?.redirect_uri ||
        import.meta.env.VITE_COGNITO_REDIRECT_URI ||
        "http://localhost:3000"

      auth.signoutRedirect({
        extraQueryParams: {
          client_id: clientId,
          logout_uri: logoutUri,
        },
      })
    },
    isLoading: auth.isLoading,
    error: auth.error,
    token: auth.user?.id_token,
  }
}
