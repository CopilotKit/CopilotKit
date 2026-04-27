"use client";

import React from "react";

export function AuthBanner({
  authenticated,
  onSignIn,
  onSignOut,
}: {
  authenticated: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  return (
    <div
      data-testid="auth-banner"
      className={`flex items-center justify-between px-4 py-3 border-b ${
        authenticated
          ? "bg-emerald-50 border-emerald-200 text-emerald-800"
          : "bg-amber-50 border-amber-200 text-amber-800"
      }`}
    >
      <div className="flex items-center gap-2 text-sm">
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            authenticated ? "bg-emerald-500" : "bg-amber-500"
          }`}
        />
        {authenticated
          ? "Signed in — bearer token attached to every request."
          : "Signed out — runtime returns 401 until you sign in."}
      </div>
      {authenticated ? (
        <button
          type="button"
          onClick={onSignOut}
          className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-emerald-100"
        >
          Sign out
        </button>
      ) : (
        <button
          data-testid="auth-sign-in"
          type="button"
          onClick={onSignIn}
          className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
        >
          Sign in (demo)
        </button>
      )}
    </div>
  );
}
