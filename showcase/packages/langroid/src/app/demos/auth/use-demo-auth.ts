"use client";

import { useCallback, useState } from "react";
import { DEMO_AUTH_HEADER, DEMO_TOKEN } from "./demo-token";

export interface DemoAuthHandle {
  authenticated: boolean;
  token: string | null;
  authorizationHeader: string | null;
  authenticate: () => void;
  signOut: () => void;
}

/**
 * In-memory auth state for the /demos/auth showcase cell. No persistence.
 */
export function useDemoAuth(): DemoAuthHandle {
  const [authenticated, setAuthenticated] = useState(false);

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
