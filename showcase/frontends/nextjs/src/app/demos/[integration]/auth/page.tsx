"use client";

// Auth demo: the runtime accepts a request only when it carries
// `Authorization: Bearer <demo token>`. The auth runtime route checks the
// header in the runtime's `onRequest` hook, before the agent runs.
//
// The first paint is signed out, so visitors land on a sign-in card. If
// <CopilotKit> mounts before the first sign-in, its first `/info` request
// gets a 401, and the 401 breaks <CopilotChat>. So it mounts only after the
// first sign-in. Then it stays mounted when the user signs out, so the chat
// can show the runtime rejecting a request. That is the point of the demo.
//
// The rejection arrives as an agent run error. The page shows the errors of
// both `onError` channels: the chat's gets the errors of its agent, such as a
// rejected run, and the provider's also gets errors such as a failed `/info`
// request.

import { useCallback, useEffect, useState } from "react";
import type { SyntheticEvent } from "react";
import { CopilotChat, CopilotKit } from "@copilotkit/react-core/v2";
import type { CopilotKitCoreErrorCode } from "@copilotkit/react-core/v2";
import type { CopilotErrorEvent } from "@copilotkit/shared";
import { useDemoRuntimeUrl } from "@/lib/demo-runtime";
import { AuthBanner } from "./auth-banner";
import { SignInCard } from "./sign-in-card";
import { useDemoAuth } from "./use-demo-auth";

// The part of a chat error event that the page reads.
interface ChatErrorEvent {
  error: Error;
  code: CopilotKitCoreErrorCode;
}

interface AuthDemoError {
  message: string;
  code: string;
}

// The provider's error events do not type their `error`.
function messageOf(error: unknown) {
  if (typeof error !== "object" || error === null || !("message" in error)) {
    return "";
  }
  return typeof error.message === "string" ? error.message : "";
}

export default function AuthDemoPage() {
  const {
    isAuthenticated,
    authorizationHeader,
    hasEverSignedIn,
    signIn,
    signOut,
  } = useDemoAuth();
  const runtimeUrl = useDemoRuntimeUrl("auth");
  const [authError, setAuthError] = useState<AuthDemoError | null>(null);

  const showError = useCallback((message: string, code: string) => {
    setAuthError({
      message: message.trim() || `Request rejected (${code})`,
      code,
    });
  }, []);

  // The provider passes the CopilotKit error code as the request operation,
  // so both channels show the same code.
  const handleProviderError = useCallback(
    (event: CopilotErrorEvent) =>
      showError(
        messageOf(event.error),
        event.context.request?.operation ?? event.type,
      ),
    [showError],
  );

  // `<CopilotChat onError>` also takes the `onError` of the chat's root
  // <div>, so the handler accepts that event too. Only a chat error has a
  // `code`, and only a chat error can be a rejected run.
  const handleChatError = useCallback(
    (event: ChatErrorEvent | SyntheticEvent<HTMLDivElement>) => {
      if (!("code" in event)) return;
      showError(event.error.message, event.code);
    },
    [showError],
  );

  // Clear the error as soon as the user signs in again. This is the only
  // place where the auth state gates the error: the render below checks
  // `authError` alone. If the render also checks `!isAuthenticated`, the two
  // race. The rejection's `onError` can commit in a render where the auth
  // state is not settled yet, and then the error never shows.
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
    // `useSingleEndpoint={false}` uses the REST transport: GET /info,
    // POST /agent/<id>/run, and so on.
    <CopilotKit
      runtimeUrl={runtimeUrl}
      agent="auth-demo"
      headers={{ Authorization: authorizationHeader }}
      useSingleEndpoint={false}
      // The dev-only inspector turns on for localhost when <CopilotKit>
      // mounts, which here is after the first sign-in. Its overlay can then
      // cover the Sign in button of the signed-out banner.
      enableInspector={false}
      onError={handleProviderError}
    >
      <div className="flex h-screen flex-col gap-3 p-6">
        <AuthBanner
          authenticated={isAuthenticated}
          onSignOut={signOut}
          onSignIn={signIn}
        />
        <header>
          <h1 className="text-lg font-semibold">Authentication</h1>
        </header>
        {authError && (
          <div
            data-testid="auth-demo-error"
            className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
          >
            <strong className="font-semibold">
              Runtime rejected the request:
            </strong>{" "}
            <span data-testid="auth-demo-error-message">
              {authError.message}
            </span>{" "}
            <code className="ml-1 rounded bg-amber-100 px-1 py-0.5 font-mono text-xs dark:bg-amber-900/40">
              {authError.code}
            </code>
          </div>
        )}
        <div className="flex-1 overflow-hidden rounded-md border border-neutral-200 dark:border-border">
          <CopilotChat
            agentId="auth-demo"
            className="h-full"
            onError={handleChatError}
          />
        </div>
      </div>
    </CopilotKit>
  );
}
