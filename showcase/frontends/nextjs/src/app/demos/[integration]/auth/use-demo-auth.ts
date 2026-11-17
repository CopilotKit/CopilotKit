"use client";

import { useCallback, useEffect, useState } from "react";
import { DEMO_AUTH_HEADER, DEMO_TOKEN } from "@/lib/demo-auth";

const STORAGE_KEY = "copilotkit:auth-demo:token";

// localStorage can throw, for example in some private browsing modes. The
// sign-in then lives in memory only.
function hasStoredSignIn() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === DEMO_TOKEN;
  } catch {
    return false;
  }
}

function storeSignIn() {
  try {
    window.localStorage.setItem(STORAGE_KEY, DEMO_TOKEN);
  } catch {
    // The in-memory state still works.
  }
}

function clearSignIn() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // The in-memory state still works.
  }
}

/**
 * The sign-in state of the auth demo. Signing in stores the demo token in
 * localStorage, so a reload keeps the user signed in. The first paint is
 * always signed out, which shows the sign-in card.
 *
 * This is a demo. Never keep a real bearer token in localStorage: every
 * script on the page can read it.
 */
export function useDemoAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  // Whether the user signed in at least once during this page session. Until
  // then the page shows the sign-in card. After a sign-out it keeps the chat,
  // which is the state that shows the runtime rejecting a request. A full
  // reload resets it.
  const [hasEverSignedIn, setHasEverSignedIn] = useState(false);

  // Read localStorage after mount. The first render must match the server
  // render, and the server has no localStorage.
  useEffect(() => {
    if (!hasStoredSignIn()) return;
    setIsAuthenticated(true);
    setHasEverSignedIn(true);
  }, []);

  const signIn = useCallback(() => {
    setIsAuthenticated(true);
    setHasEverSignedIn(true);
    storeSignIn();
  }, []);

  // `hasEverSignedIn` stays true, so the chat stays on the page.
  const signOut = useCallback(() => {
    setIsAuthenticated(false);
    clearSignIn();
  }, []);

  return {
    isAuthenticated,
    /** The `Authorization` header to send, or `null` when signed out. */
    authorizationHeader: isAuthenticated ? DEMO_AUTH_HEADER : null,
    hasEverSignedIn,
    signIn,
    signOut,
  };
}
