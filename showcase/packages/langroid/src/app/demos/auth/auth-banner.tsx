"use client";

interface AuthBannerProps {
  authenticated: boolean;
  onAuthenticate: () => void;
  onSignOut: () => void;
}

/**
 * Sticky banner above <CopilotChat /> that reflects and toggles demo auth
 * state. Pure presentational. Testids are stable contract for QA + Playwright.
 */
export function AuthBanner({
  authenticated,
  onAuthenticate,
  onSignOut,
}: AuthBannerProps) {
  const wrapperClass = authenticated
    ? "border-emerald-300 bg-emerald-50 text-emerald-900"
    : "border-amber-300 bg-amber-50 text-amber-900";
  const statusText = authenticated
    ? "✓ Signed in as demo user"
    : "⚠ Signed out — the agent will reject your messages until you sign in.";

  return (
    <div
      data-testid="auth-banner"
      data-authenticated={authenticated ? "true" : "false"}
      className={`sticky top-0 z-10 flex items-center justify-between gap-3 rounded-md border px-4 py-3 text-sm ${wrapperClass}`}
    >
      <span data-testid="auth-status" className="font-medium">
        {statusText}
      </span>
      {authenticated ? (
        <button
          type="button"
          data-testid="auth-sign-out-button"
          onClick={onSignOut}
          className="rounded border border-emerald-400 bg-white px-3 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
        >
          Sign out
        </button>
      ) : (
        <button
          type="button"
          data-testid="auth-authenticate-button"
          onClick={onAuthenticate}
          className="rounded border border-amber-400 bg-white px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100"
        >
          Sign in
        </button>
      )}
    </div>
  );
}
