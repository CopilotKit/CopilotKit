"use client";

import { useCallback, useEffect, useState } from "react";
import { DEMO_TOKEN } from "./demo-token";

const STORAGE_KEY = "copilotkit:auth-demo:token";

export interface DemoAuthHandle {
  isAuthenticated: boolean;
  /** The token string when authenticated, otherwise null. */
  token: string | null;
  /** The full `Bearer <token>` value when authenticated, otherwise null. */
  authorizationHeader: string | null;
  /** Sign in with the provided token. */
  signIn: (token: string) => void;
  /** Clear the stored token. */
  signOut: () => void;
}

/**
 * Persistent demo auth state for the /demos/auth showcase cell. Tokens are
 * stored in localStorage so a page reload doesn't kick the user back out;
 * first paint of a fresh visitor is unauthenticated, which lets the demo
 * showcase its sign-in CTA up front.
 *
 * This is a DEMO. Never store real bearer tokens in localStorage in a
 * production application — that exposes them to any script running on the
 * page.
 */
export function useDemoAuth(): DemoAuthHandle {
  const [token, setToken] = useState<string | null>(null);

  // Hydrate from localStorage after mount. Reading on initial render would
  // mismatch SSR (where window is undefined); deferring to useEffect keeps
  // first paint unauthenticated and avoids hydration warnings.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) setToken(stored);
    } catch {
      // localStorage unavailable (privacy mode, etc.) — fall back to
      // in-memory only.
    }
  }, []);

  const signIn = useCallback((nextToken: string) => {
    setToken(nextToken);
    try {
      window.localStorage.setItem(STORAGE_KEY, nextToken);
    } catch {
      // Ignore — in-memory state still works.
    }
  }, []);

  const signOut = useCallback(() => {
    setToken(null);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore.
    }
  }, []);

  // The runtime gate compares against a fixed token, so anything other than
  // DEMO_TOKEN won't actually authenticate against the API. We still allow
  // arbitrary strings here because validation is the runtime's job — the UI
  // just owns "what header are we sending".
  return {
    isAuthenticated: token !== null,
    token,
    authorizationHeader: token ? `Bearer ${token}` : null,
    signIn,
    signOut,
  };
}
