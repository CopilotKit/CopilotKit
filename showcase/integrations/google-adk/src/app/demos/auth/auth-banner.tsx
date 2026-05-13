"use client";

interface AuthBannerProps {
  authenticated: boolean;
  onSignOut: () => void;
  onSignIn: () => void;
}

/**
 * Status strip rendered above <CopilotChat /> in both authenticated and
 * post-sign-out states. The post-sign-out (amber) variant exists so the demo
 * actually showcases what its name promises — the runtime rejecting an
 * unauthenticated request — instead of bouncing the user back to the gate
 * page where the rejection never happens.
 *
 * Pure presentational — owns no state itself. Testids are stable contract
 * for QA + Playwright specs.
 */
export function AuthBanner({
  authenticated,
  onSignOut,
  onSignIn,
}: AuthBannerProps) {
  const classes = authenticated
    ? "border-emerald-300 bg-emerald-50 text-emerald-900"
    : "border-amber-300 bg-amber-50 text-amber-900";

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
        <button
          type="button"
          data-testid="auth-sign-out-button"
          onClick={onSignOut}
          className="inline-flex h-8 items-center justify-center rounded-md border border-emerald-400 bg-white px-3 text-xs font-medium text-emerald-800 shadow-sm hover:bg-emerald-100"
        >
          Sign out
        </button>
      ) : (
        <button
          type="button"
          data-testid="auth-authenticate-button"
          onClick={onSignIn}
          className="inline-flex h-8 items-center justify-center rounded-md border border-amber-400 bg-white px-3 text-xs font-medium text-amber-800 shadow-sm hover:bg-amber-100"
        >
          Sign in
        </button>
      )}
    </div>
  );
}
