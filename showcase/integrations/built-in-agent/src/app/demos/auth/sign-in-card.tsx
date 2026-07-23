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
 * `useDemoAuth()`, which causes the parent to mount the chat surface.
 *
 * Note: built-in-agent is a deliberately minimal integration with no
 * `@/components/ui` shadcn primitives, so this uses raw Tailwind-styled
 * elements rather than the shared `Card`/`Button` components that
 * langgraph-python (the gold reference) uses. The testids and behavior match.
 */
export function SignInCard({ onSignIn }: SignInCardProps) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div
        data-testid="auth-sign-in-card"
        className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
      >
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-neutral-900">
            Sign in to start chatting
          </h2>
          <p className="mt-1 text-sm text-neutral-600">
            The runtime rejects requests without an{" "}
            <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs">
              Authorization
            </code>{" "}
            header. Sign in below to mount the chat with a demo bearer token
            attached.
          </p>
        </div>
        <div className="mb-4 space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Demo token
          </p>
          <code
            data-testid="auth-demo-token"
            className="block rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-sm text-neutral-800"
          >
            {DEMO_TOKEN}
          </code>
          <p className="text-xs text-neutral-500">
            Real apps should issue per-user tokens via your identity provider
            and never hard-code shared secrets.
          </p>
        </div>
        <button
          type="button"
          data-testid="auth-sign-in-button"
          onClick={() => onSignIn(DEMO_TOKEN)}
          className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Sign in with demo token
        </button>
      </div>
    </div>
  );
}
