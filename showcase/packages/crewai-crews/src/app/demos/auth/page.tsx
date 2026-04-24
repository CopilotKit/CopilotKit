"use client";

// Auth demo — framework-native request authentication via the V2 runtime's
// `onRequest` hook. The banner toggles an in-memory React auth flag; when
// `authenticated === true`, <CopilotKit headers={...}> injects the
// `Authorization: Bearer <demo-token>` header on every request. The runtime
// route (/api/copilotkit-auth) rejects any request without the header.
//
// Backend: reuses the shared CrewAI crew via HttpAgent (same topology as the
// other chat cells). The auth gate is enforced in the Next.js runtime, not
// in the Python server, so the underlying crew needs no changes.
//
// Default UX: the page loads authenticated so the initial `/info` handshake
// succeeds and the chat is immediately usable. Clicking "Sign out" flips to
// the unauthenticated state — the next chat submission (and any re-fetch of
// `/info`) will 401, which we surface via the page-level error banner. This
// inverts the historical unauth-first flow, which crashed the page on load
// when `/info` returned 401 before `onError` handlers could attach.
//
// Error surfacing: <CopilotChat /> surfaces transport errors inconsistently
// across states, so this page additionally captures errors via the
// <CopilotKit onError> prop and renders a persistent error banner below the
// chat. A local ErrorBoundary guards against any uncaught render-time error
// from chat internals in the unauthenticated state so the page never white-
// screens — instead, the user sees a clear in-page message.

import { Component, useCallback, useMemo, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { CopilotKit, CopilotChat } from "@copilotkit/react-core/v2";
import { useDemoAuth } from "./use-demo-auth";
import { AuthBanner } from "./auth-banner";

interface ChatErrorBoundaryProps {
  authenticated: boolean;
  children: ReactNode;
}

interface ChatErrorBoundaryState {
  error: Error | null;
}

/**
 * Guards <CopilotChat /> against uncaught render-time errors. If the chat
 * internals throw (most commonly while the app is in the unauthenticated
 * state and a transient response payload is missing), we render a clear
 * in-page message instead of white-screening the entire route. The boundary
 * resets whenever `authenticated` flips, so signing back in restores the
 * live chat without requiring a full page reload.
 */
class ChatErrorBoundary extends Component<
  ChatErrorBoundaryProps,
  ChatErrorBoundaryState
> {
  state: ChatErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ChatErrorBoundaryState {
    return { error };
  }

  componentDidUpdate(prevProps: ChatErrorBoundaryProps): void {
    // Reset on auth transition so signing in re-mounts a fresh <CopilotChat />.
    if (
      prevProps.authenticated !== this.props.authenticated &&
      this.state.error
    ) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the console trail for devtools but do not rethrow.
    console.error("[auth-demo] chat error boundary caught:", error, info);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          data-testid="auth-demo-chat-boundary"
          className="flex h-full items-center justify-center p-6 text-center text-sm text-neutral-600"
        >
          <div>
            <p className="font-medium text-neutral-800">
              Chat unavailable while signed out
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              Click Sign in above to restore the conversation.
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function AuthDemoPage() {
  const auth = useDemoAuth();
  const [lastError, setLastError] = useState<string | null>(null);

  // Clear any stale error when auth state flips (authenticate OR sign out).
  const authenticate = useCallback(() => {
    setLastError(null);
    auth.authenticate();
  }, [auth]);

  const signOut = useCallback(() => {
    setLastError(null);
    auth.signOut();
  }, [auth]);

  // Compute headers reactively. The provider reads the latest headers prop
  // on every request via a useEffect that calls `copilotkit.setHeaders(...)`
  // whenever the merged headers object changes.
  const headers = useMemo<Record<string, string>>(() => {
    const h: Record<string, string> = {};
    if (auth.authorizationHeader) {
      h.Authorization = auth.authorizationHeader;
    }
    return h;
  }, [auth.authorizationHeader]);

  const onError = useCallback(
    (errorEvent: {
      error?: { message?: string; status?: number; statusCode?: number };
      context?: { response?: { status?: number } };
    }) => {
      const err = errorEvent?.error;
      const message = err?.message ?? "Request failed";
      const status =
        err?.status ?? err?.statusCode ?? errorEvent?.context?.response?.status;
      if (status === 401 || /401|unauthor/i.test(message)) {
        setLastError(
          "401 Unauthorized — click Sign in above to restore access.",
        );
      } else {
        setLastError(message);
      }
    },
    [],
  );

  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit-auth"
      agent="auth-demo"
      headers={headers}
      onError={onError}
    >
      <div className="flex h-screen flex-col gap-3 p-6">
        <AuthBanner
          authenticated={auth.authenticated}
          onAuthenticate={authenticate}
          onSignOut={signOut}
        />
        <header>
          <h1 className="text-lg font-semibold">Authentication</h1>
          <p className="text-sm text-neutral-600">
            The runtime rejects requests without a valid Bearer token via an{" "}
            <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs">
              onRequest
            </code>{" "}
            hook. You start signed in — click Sign out above to exercise the 401
            path, then Sign in to restore access.
          </p>
        </header>
        <div className="flex-1 overflow-hidden rounded-md border border-neutral-200">
          <ChatErrorBoundary authenticated={auth.authenticated}>
            <CopilotChat agentId="auth-demo" className="h-full" />
          </ChatErrorBoundary>
        </div>
        {lastError && (
          <div
            role="alert"
            data-testid="auth-demo-error"
            className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-900"
          >
            {lastError}
          </div>
        )}
      </div>
    </CopilotKit>
  );
}
