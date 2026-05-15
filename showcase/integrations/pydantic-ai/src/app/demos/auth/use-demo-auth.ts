"use client";

import { useCallback, useState } from "react";
import { DEMO_AUTH_HEADER, DEMO_TOKEN } from "./demo-token";

export interface DemoAuthHandle {
  authenticated: boolean;
  /** The token string when authenticated, otherwise null. */
  token: string | null;
  /** The full `Bearer <token>` value when authenticated, otherwise null. */
  authorizationHeader: string | null;
  authenticate: () => void;
  signOut: () => void;
}

/**
 * In-memory auth state for the /demos/auth showcase cell. No persistence —
 * refreshing the page resets to the default authenticated state, which keeps
 * the demo immediately usable and avoids the 401 crash on initial `/info`
 * fetch that happens when starting unauthenticated. Users can click "Sign
 * out" to exercise the unauthenticated / 401 path on demand.
 */
export function useDemoAuth(): DemoAuthHandle {
  const [authenticated, setAuthenticated] = useState(true);

  const authenticate = useCallback(() => {
    setAuthenticated(true);
  }, []);

  const signOut = useCallback(() => {
    setAuthenticated(false);
  }, []);

  return {
    authenticated,
    token: authenticated ? DEMO_TOKEN : null,
    authorizationHeader: authenticated ? DEMO_AUTH_HEADER : null,
    authenticate,
    signOut,
  };
}
