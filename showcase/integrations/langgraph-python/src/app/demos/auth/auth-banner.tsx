"use client";

import { Button } from "@/components/ui/button";

interface AuthBannerProps {
  onSignOut: () => void;
}

/**
 * Status strip rendered above <CopilotChat /> while the user is signed in.
 * Pure presentational — owns no state itself. Testids are stable contract
 * for QA + Playwright specs.
 */
export function AuthBanner({ onSignOut }: AuthBannerProps) {
  return (
    <div
      data-testid="auth-banner"
      data-authenticated="true"
      className="flex items-center justify-between gap-3 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-900"
    >
      <span data-testid="auth-status" className="font-medium">
        Signed in as demo user
      </span>
      <Button
        type="button"
        data-testid="auth-sign-out-button"
        size="sm"
        variant="outline"
        onClick={onSignOut}
      >
        Sign out
      </Button>
    </div>
  );
}
