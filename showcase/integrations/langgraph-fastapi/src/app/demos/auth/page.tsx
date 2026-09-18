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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CopilotKit,
  CopilotChat,
  useCopilotKit,
} from "@copilotkit/react-core/v2";
import type { CopilotKitCoreErrorCode } from "@copilotkit/react-core/v2";
import { AuthBanner } from "./auth-banner";
import { SignInCard } from "./sign-in-card";
import { useDemoAuth } from "./use-demo-auth";
import { DEMO_TOKEN } from "./demo-token";

interface AuthDemoErrorState {
  message: string;
  code: CopilotKitCoreErrorCode | string;
}

function AuthRequestOwnership({
  getGeneration,
  recordError,
}: {
  getGeneration: () => number;
  recordError: (error: Error, generation: number) => void;
}) {
  const { copilotkit } = useCopilotKit();

  useEffect(() => {
    const active = new Set<{ unsubscribe: () => void }>();
    const coreSubscription = copilotkit.subscribe({
      onAgentRunStarted: ({ agent }) => {
        if (agent.agentId !== "auth-demo") return;
        const generation = getGeneration();
        const subscription = agent.subscribe({
          onRunFailed: ({ error }) => recordError(error, generation),
          onRunFinalized: () => {
            subscription.unsubscribe();
            active.delete(subscription);
          },
        });
        active.add(subscription);
      },
    });
    return () => {
      coreSubscription.unsubscribe();
      for (const subscription of active) subscription.unsubscribe();
    };
  }, [copilotkit, getGeneration, recordError]);

  return null;
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
    (): Record<string, string> =>
      authorizationHeader ? { Authorization: authorizationHeader } : {},
    [authorizationHeader],
  );

  const [authError, setAuthError] = useState<AuthDemoErrorState | null>(null);
  const authGeneration = useRef(0);
  const errorGenerations = useRef(new WeakMap<object, number>());
  const getGeneration = useCallback(() => authGeneration.current, []);
  const recordError = useCallback((error: Error, generation: number) => {
    errorGenerations.current.set(error, generation);
  }, []);
  const signInCurrentSession = useCallback(
    (token: string) => {
      authGeneration.current += 1;
      setAuthError(null);
      signIn(token);
    },
    [signIn],
  );
  const signOutCurrentSession = useCallback(() => {
    authGeneration.current += 1;
    signOut();
  }, [signOut]);

  // Shared error handler wired to BOTH the provider-level and chat-level
  // `onError` channels (see the file header for why both are needed).
  const handleAuthError = useCallback((event: unknown) => {
    if (typeof event !== "object" || event === null || !("error" in event))
      return;
    const detail = event.error;
    if (typeof detail === "object" && detail !== null) {
      const generation = errorGenerations.current.get(detail);
      if (generation !== undefined && generation !== authGeneration.current)
        return;
    }
    const rawMessage =
      typeof detail === "object" &&
      detail !== null &&
      "message" in detail &&
      typeof detail.message === "string"
        ? detail.message
        : "";
    const code =
      "code" in event && typeof event.code === "string"
        ? event.code
        : "type" in event && typeof event.type === "string"
          ? event.type
          : "request_error";
    setAuthError({
      message: rawMessage.trim() || `Request rejected (${code})`,
      code,
    });
  }, []);

  // Re-authentication clears the visible error. Request ownership above also
  // prevents an older rejected request from restoring it after this effect.
  useEffect(() => {
    if (isAuthenticated) setAuthError(null);
  }, [isAuthenticated]);

  if (!hasEverSignedIn) {
    return (
      <div className="flex h-screen flex-col">
        <SignInCard onSignIn={signInCurrentSession} />
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
      onError={handleAuthError}
    >
      <AuthRequestOwnership
        getGeneration={getGeneration}
        recordError={recordError}
      />
      <div className="flex h-screen flex-col gap-3 p-6">
        <AuthBanner
          authenticated={isAuthenticated}
          onSignOut={signOutCurrentSession}
          onSignIn={() => signInCurrentSession(DEMO_TOKEN)}
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
