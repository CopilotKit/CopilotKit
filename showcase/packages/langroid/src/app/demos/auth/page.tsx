"use client";

// Auth demo — framework-native request authentication via the V2 runtime's
// `onRequest` hook. The banner toggles an in-memory React auth flag; when
// `authenticated === true`, <CopilotKit headers={...}> injects the
// `Authorization: Bearer <demo-token>` header on every request. The runtime
// route (/api/copilotkit-auth) rejects any request without the header.

import { useCallback, useMemo, useState } from "react";
import { CopilotKit, CopilotChat } from "@copilotkit/react-core/v2";
import { useDemoAuth } from "./use-demo-auth";
import { AuthBanner } from "./auth-banner";

export default function AuthDemoPage() {
  const auth = useDemoAuth();
  const [lastError, setLastError] = useState<string | null>(null);

  const authenticate = useCallback(() => {
    setLastError(null);
    auth.authenticate();
  }, [auth]);

  const signOut = useCallback(() => {
    setLastError(null);
    auth.signOut();
  }, [auth]);

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
          "401 Unauthorized - click Authenticate above to send messages.",
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
            hook. Try sending a message while unauthenticated, then click
            Authenticate.
          </p>
        </header>
        <div className="flex-1 overflow-hidden rounded-md border border-neutral-200">
          <CopilotChat agentId="auth-demo" className="h-full" />
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
