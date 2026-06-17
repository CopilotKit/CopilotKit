"use client";

import { DEMO_TOKEN } from "./demo-token";

interface SignInCardProps {
  onSignIn: (token: string) => void;
}

/**
 * Unauthenticated landing card for the auth demo. Surfaces the demo bearer
 * token in plain text so visitors can see exactly what gets sent on the
 * `Authorization` header — there's no real form because the value is fixed
 * by the runtime gate. Clicking "Sign in" stores the token via
 * `useDemoAuth()`, which causes the parent to mount `<CopilotKit>`.
 */
export function SignInCard({ onSignIn }: SignInCardProps) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div
        data-testid="auth-sign-in-card"
        className="w-full max-w-md rounded-lg border border-neutral-200 bg-white shadow-sm"
      >
        <div className="flex flex-col gap-1.5 p-6">
          <h3 className="text-lg font-semibold leading-none tracking-tight">
            Sign in to start chatting
          </h3>
          <p className="text-sm text-neutral-500">
            The runtime rejects requests without an{" "}
            <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs">
              Authorization
            </code>{" "}
            header. Sign in below to mount the chat with a demo bearer token
            attached.
          </p>
        </div>
        <div className="space-y-3 px-6 pb-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              Demo token
            </p>
            <code
              data-testid="auth-demo-token"
              className="mt-1 block rounded-md border border-neutral-200 bg-neutral-100 px-3 py-2 font-mono text-sm"
            >
              {DEMO_TOKEN}
            </code>
          </div>
          <p className="text-xs text-neutral-500">
            Real apps should issue per-user tokens via your identity provider
            and never hard-code shared secrets.
          </p>
        </div>
        <div className="p-6 pt-0">
          <button
            type="button"
            data-testid="auth-sign-in-button"
            className="inline-flex h-9 w-full items-center justify-center rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white shadow hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-950 disabled:pointer-events-none disabled:opacity-50"
            onClick={() => onSignIn(DEMO_TOKEN)}
          >
            Sign in with demo token
          </button>
        </div>
      </div>
    </div>
  );
}
