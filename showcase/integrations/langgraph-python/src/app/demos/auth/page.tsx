"use client";

// Auth demo — framework-native request authentication via the V2 runtime's
// `onRequest` hook. The runtime route (/api/copilotkit-auth) rejects any
// request whose `Authorization: Bearer <demo-token>` header is missing or
// wrong.
//
// UX shape: the demo defaults to UNAUTHENTICATED on first paint so visitors
// land on a clear sign-in card. We don't render `<CopilotKit>` until the user
// has a token — that sidesteps the transport 401 that would otherwise crash
// `<CopilotChat>` during its initial `/info` handshake. Once signed in,
// `<CopilotKit>` mounts with the bearer header attached, the chat boots
// cleanly, and signing out unmounts the whole tree.

import { useMemo } from "react";
import { CopilotKit, CopilotChat } from "@copilotkit/react-core/v2";
import { AuthBanner } from "./auth-banner";
import { SignInCard } from "./sign-in-card";
import { useDemoAuth } from "./use-demo-auth";

export default function AuthDemoPage() {
  const { isAuthenticated, authorizationHeader, signIn, signOut } =
    useDemoAuth();

  const headers = useMemo<Record<string, string>>(
    () => (authorizationHeader ? { Authorization: authorizationHeader } : {}),
    [authorizationHeader],
  );

  if (!isAuthenticated) {
    return (
      <div className="flex h-screen flex-col">
        <SignInCard onSignIn={signIn} />
      </div>
    );
  }

  return (
    // `useSingleEndpoint={false}` opts into the V2 multi-endpoint protocol
    // (separate /info, /agents/<id>/run, etc.), which is what this demo's
    // runtime route is wired up for.
    <CopilotKit
      runtimeUrl="/api/copilotkit-auth"
      agent="auth-demo"
      headers={headers}
      useSingleEndpoint={false}
    >
      <div className="flex h-screen flex-col gap-3 p-6">
        <AuthBanner onSignOut={signOut} />
        <header>
          <h1 className="text-lg font-semibold">Authentication</h1>
        </header>
        <div className="flex-1 overflow-hidden rounded-md border border-neutral-200">
          <CopilotChat agentId="auth-demo" className="h-full" />
        </div>
      </div>
    </CopilotKit>
  );
}
