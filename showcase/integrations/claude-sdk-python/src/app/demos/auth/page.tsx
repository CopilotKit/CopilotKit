"use client";

// Auth demo — framework-native request authentication via the V2 runtime's
// `onRequest` hook. The banner toggles an in-memory React auth flag; when
// `authenticated === true`, <CopilotKit headers={...}> injects the
// `Authorization: Bearer <demo-token>` header on every request. The runtime
// route (/api/copilotkit-auth) rejects any request without the header.
//
// Default UX: the page loads authenticated so the initial `/info` handshake
// succeeds and the chat is immediately usable. Clicking "Sign out" flips to
// the unauthenticated state — the next chat submission (and any re-fetch of
// `/info`) will 401, which we surface via the page-level error banner. This
// inverts the historical unauth-first flow, which crashed the page on load
// when `/info` returned 401 before `onError` handlers could attach.
//
// Error surfacing: the post-sign-out 401 manifests as an AGENT-RUN error
// (`agent_run_failed`), and that event is delivered to the AGENT-SCOPED
// `<CopilotChat onError>` channel — NOT the provider-level `<CopilotKit
// onError>`. The transport `/agent/<id>/run` POST returns 200; the auth
// rejection rides inside the stream as an agent-run failure, so a demo that
// listens only on `<CopilotKit onError>` never sees it and never renders the
// banner. We therefore register the same handler on BOTH channels:
// `<CopilotKit onError>` covers provider-level errors (e.g. the `/info`
// handshake) and `<CopilotChat onError>` covers the agent-run rejection that
// the sign-out path produces. The error surface is keyed off `lastError`
// STATE and cleared on re-auth via an effect, so a rejection always renders
// and signing back in always wipes it. A local ErrorBoundary still guards
// against any uncaught render-time error from chat internals so the page
// never white-screens.

import { Component, useCallback, useEffect, useMemo, useState } from "react";
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

  // Clear stale errors as soon as the user re-authenticates. This is the
  // ONLY thing that gates the error surface on auth state — the render
  // condition below keys off `lastError` alone. Clearing the error inside
  // the sign-out handler (the obvious-but-wrong guard) created a race: the
  // sign-out wipes `lastError`, then the post-sign-out rejection's `onError`
  // sets it again — but if the order ever inverts, the banner flickers or
  // never appears. Driving the surface off `lastError` and clearing it here
  // only on re-auth removes that ordering dependency: a rejection always
  // renders, and signing back in always wipes it.
  useEffect(() => {
    if (auth.authenticated) setLastError(null);
  }, [auth.authenticated]);

  const authenticate = useCallback(() => {
    auth.authenticate();
  }, [auth]);

  const signOut = useCallback(() => {
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

  // Shared handler wired to BOTH the provider-level `<CopilotKit onError>`
  // and the agent-scoped `<CopilotChat onError>` (see the file header for why
  // both are needed). The event shape is identical across both channels:
  // `{ error: Error; code; context }`. Some transport errors decorate the
  // `Error` with a numeric `status`/`statusCode`; we read those defensively
  // and fall back to matching the 401 in the message text.
  const onError = useCallback(
    (errorEvent: {
      error: Error & { status?: number; statusCode?: number };
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
      useSingleEndpoint={false}
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
            <CopilotChat
              agentId="auth-demo"
              className="h-full"
              onError={onError}
            />
          </ChatErrorBoundary>
        </div>
        {lastError && (
          <div
            role="alert"
            data-testid="auth-demo-error"
            className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-900"
          >
            <span data-testid="auth-demo-error-message">{lastError}</span>
          </div>
        )}
      </div>
    </CopilotKit>
  );
}
