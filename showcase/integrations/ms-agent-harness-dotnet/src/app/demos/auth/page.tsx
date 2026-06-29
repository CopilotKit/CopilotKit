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
//
// Error surfacing: the post-sign-out 401 is captured via the AGENT-SCOPED
// `<CopilotChat onError>` channel, NOT the provider-level `<CopilotKit
// onError>` alone. Agent-run errors (`agent_run_failed`) are reliably
// delivered to the chat-scoped subscription, whereas the provider-level
// handler does not fire for them in this flow — so a demo that relies only
// on `<CopilotKit onError>` never renders the rejection banner. We register
// the same handler on BOTH channels: `<CopilotKit onError>` covers any
// provider-level errors (e.g. the initial `/info` handshake) and
// `<CopilotChat onError>` covers agent-run rejections, which is what the
// sign-out path produces.

import { useCallback, useEffect, useMemo, useState } from "react";
import { CopilotKit, CopilotChat } from "@copilotkit/react-core/v2";
import type { CopilotKitCoreErrorCode } from "@copilotkit/react-core/v2";
import { AuthBanner } from "./auth-banner";
import { SignInCard } from "./sign-in-card";
import { useDemoAuth } from "./use-demo-auth";
import { DEMO_TOKEN } from "./demo-token";

interface AuthDemoErrorState {
  message: string;
  code: CopilotKitCoreErrorCode | string;
}

interface AuthErrorEvent {
  error?: { message?: string } | null;
  code: CopilotKitCoreErrorCode;
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

  // Shared error handler wired to BOTH the provider-level and chat-level
  // `onError` channels (see the file header for why both are needed).
  const handleAuthError = useCallback((event: AuthErrorEvent) => {
    setAuthError({
      message:
        (event.error?.message && event.error.message.trim()) ||
        (event.code
          ? `Request rejected (${event.code})`
          : "The request was rejected."),
      code: event.code,
    });
  }, []);

  // Clear stale errors as soon as the user re-authenticates. This is the
  // ONLY thing that gates the amber error surface on auth state — the render
  // condition below keys off `authError` alone. Coupling the render to a
  // second `!isAuthenticated` slice (the obvious-but-wrong guard) created a
  // post-sign-out race: the rejection's `onError` fires and calls
  // `setAuthError`, but if that commit landed in a render where the auth
  // state hadn't yet settled to false, `authError && !isAuthenticated`
  // evaluated false and the banner never appeared. Driving the surface off
  // `authError` and clearing it here on re-auth removes the cross-slice
  // ordering dependency: a rejection always renders, and signing back in
  // always wipes it.
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
      // The dev-only inspector overlay is auto-enabled on localhost after
      // <CopilotKit> mounts. In this demo that happens only after the first
      // sign-in, so the post-sign-out Sign in button can sit underneath the
      // overlay in local/D5 runs even though production never shows it.
      enableInspector={false}
      onError={handleAuthError}
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
        {authError && (
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
          <CopilotChat
            agentId="auth-demo"
            className="h-full"
            onError={handleAuthError}
          />
        </div>
      </div>
    </CopilotKit>
  );
}
