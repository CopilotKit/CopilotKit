"use client";

import { Button } from "@/components/ui/button";

interface AuthBannerProps {
  authenticated: boolean;
  onSignOut: () => void;
  onSignIn: () => void;
}

/**
 * The status strip above the chat, signed in (green) or signed out (amber).
 * After a sign-out the page keeps the chat under the amber strip, so the user
 * can send a message and watch the runtime reject it.
 *
 * It holds no state. The test ids are a stable contract for QA and the e2e
 * specs.
 */
export function AuthBanner({
  authenticated,
  onSignOut,
  onSignIn,
}: AuthBannerProps) {
  const classes = authenticated
    ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
    : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300";

  return (
    <div
      data-testid="auth-banner"
      data-authenticated={authenticated ? "true" : "false"}
      className={`flex items-center justify-between gap-3 rounded-md border px-4 py-2 text-sm ${classes}`}
    >
      <span data-testid="auth-status" className="font-medium">
        {authenticated
          ? "✓ Signed in as demo user"
          : "⚠ Signed out — the agent will reject your messages until you sign in."}
      </span>
      {authenticated ? (
        <Button
          type="button"
          data-testid="auth-sign-out-button"
          size="sm"
          variant="outline"
          onClick={onSignOut}
        >
          Sign out
        </Button>
      ) : (
        <Button
          type="button"
          data-testid="auth-authenticate-button"
          size="sm"
          onClick={onSignIn}
        >
          Sign in
        </Button>
      )}
    </div>
  );
}
