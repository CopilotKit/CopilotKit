"use client";

// Auth demo — framework-native request authentication via the V2 runtime's
// `onRequest` hook. The runtime route (/api/copilotkit-auth) rejects any
// request whose `Authorization: Bearer <demo-token>` header is missing or
// wrong.
//
// UX shape: the demo defaults to UNAUTHENTICATED on first paint so visitors
// land on a clear sign-in card. We don't render `<CopilotKit>` until the user
// has signed in at least once — that sidesteps the transport 401 that would
// otherwise crash `<CopilotChat>` during its initial `/info` handshake.
// After the user signs in once, `<CopilotKit>` stays mounted across the
// sign-out → sign-in cycle so the post-sign-out state can actually
// demonstrate the runtime rejecting unauthenticated requests in the chat
// surface (the whole point of the demo).

import { useEffect, useMemo, useState } from "react";
import {
  CopilotKit,
  CopilotChat,
  type CopilotKitCoreErrorCode,
} from "@copilotkit/react-core/v2";
import { AuthBanner } from "./auth-banner";
import { SignInCard } from "./sign-in-card";
import { useDemoAuth } from "./use-demo-auth";
import { DEMO_TOKEN } from "./demo-token";

interface AuthDemoErrorState {
  message: string;
  code: CopilotKitCoreErrorCode | string;
}

export default function AuthDemoPage() {
  const {
    isAuthenticated,
    authorizationHeader,
    hasEverSignedIn,
    signIn,
    signOut,
  } = useDemoAuth();

  const headers = useMemo<Record<string, string>>(
    () => (authorizationHeader ? { Authorization: authorizationHeader } : {}),
    [authorizationHeader],
  );

  const [authError, setAuthError] = useState<AuthDemoErrorState | null>(null);

  // Clear stale errors as soon as the user re-authenticates. Without this
  // the amber error surface would persist after sign-in even though the
  // failure is no longer relevant.
  useEffect(() => {
    if (isAuthenticated) setAuthError(null);
  }, [isAuthenticated]);

  if (!hasEverSignedIn) {
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
      onError={(event) => {
        setAuthError({
          message: event.error?.message ?? String(event.error),
          code: event.code,
        });
      }}
    >
      <div className="flex h-screen flex-col gap-3 p-6">
        <AuthBanner
          authenticated={isAuthenticated}
          onSignOut={signOut}
          onSignIn={() => signIn(DEMO_TOKEN)}
        />
        <header>
          <h1 className="text-lg font-semibold">Authentication</h1>
        </header>
        {authError && !isAuthenticated && (
          <div
            data-testid="auth-demo-error"
            className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          >
            <strong className="font-semibold">
              Runtime rejected the request:
            </strong>{" "}
            <span data-testid="auth-demo-error-message">
              {authError.message}
            </span>{" "}
            <code className="ml-1 rounded bg-amber-100 px-1 py-0.5 font-mono text-xs">
              {authError.code}
            </code>
          </div>
        )}
        <div className="flex-1 overflow-hidden rounded-md border border-neutral-200">
          <CopilotChat agentId="auth-demo" className="h-full" />
        </div>
      </div>
    </CopilotKit>
  );
}
