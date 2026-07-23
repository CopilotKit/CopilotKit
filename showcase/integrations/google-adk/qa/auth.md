# QA: Authentication — Google ADK

## Prerequisites

- Demo deployed and accessible at /demos/auth
- ADK agent backend healthy (check /api/health)
- GOOGLE_API_KEY set in the deployment

## Test Steps

### 1. Initial unauthenticated state (SignInCard)

- [ ] Navigate to /demos/auth (in a fresh browser session — clear
      `localStorage["copilotkit:auth-demo:token"]` if it exists)
- [ ] Verify the SignInCard is visible (`data-testid="auth-sign-in-card"`)
- [ ] Verify the demo token is displayed in plain text
      (`data-testid="auth-demo-token"`)
- [ ] Verify the "Sign in with demo token" button is enabled
      (`data-testid="auth-sign-in-button"`)
- [ ] Verify the AuthBanner is NOT yet rendered
      (`data-testid="auth-banner"` absent)
- [ ] Verify the chat composer is NOT yet rendered (no "Type a message" placeholder)
- [ ] Verify no console errors on page load

### 2. Signing in mounts the chat surface

- [ ] Click "Sign in with demo token"
- [ ] Verify the AuthBanner appears with the green/success variant
      (`data-authenticated="true"`)
- [ ] Verify the auth-status text reads "✓ Signed in as demo user"
- [ ] Verify the "Sign out" button is visible and enabled
      (`data-testid="auth-sign-out-button"`)
- [ ] Verify the SignInCard is gone (`data-testid="auth-sign-in-card"` absent)
- [ ] Verify the chat composer is mounted ("Type a message" placeholder visible)
- [ ] Verify no `auth-demo-error` surface

### 3. Authenticated send → assistant response

- [ ] Type "Hello" and press Enter
- [ ] Within 30 seconds, an assistant message is rendered
      (`[data-role="assistant"]`)
- [ ] No auth-demo-error surface appears

### 4. Sign out flips banner amber, keeps chat mounted

- [ ] Click "Sign out"
- [ ] Within 1 second, the banner flips to the amber variant
      (`data-authenticated="false"`)
- [ ] Verify the auth-status text reads
      "⚠ Signed out — the agent will reject your messages until you sign in."
- [ ] Verify the "Sign in" button is visible
      (`data-testid="auth-authenticate-button"`)
- [ ] Verify the chat composer is STILL visible — page must not return
      to the SignInCard
- [ ] Verify no white-screen

### 5. Unauthenticated send surfaces a 401 without crashing

- [ ] After signing out, type "Hello again" and press Enter
- [ ] Within 15 seconds, the page-level error surface appears:
      `data-testid="auth-demo-error"` with the runtime's 401 message
- [ ] Verify the banner is STILL visible
- [ ] Verify no assistant response appears

### 6. Re-signing in clears the error and resumes chat

- [ ] Click "Sign in" (amber-state authenticate button)
- [ ] Within 1 second, the banner flips back to green
- [ ] Verify the `auth-demo-error` surface is cleared
- [ ] Type "Hello" and press Enter; an assistant response appears within 30s

### 7. Hard-reload behavior

- [ ] Hard-reload the page (clear cache + reload)
- [ ] With a valid `localStorage` token, the demo lands directly in the
      authenticated chat state (no SignInCard)
- [ ] With `localStorage` cleared, the demo lands on the SignInCard

### 8. Error Handling

- [ ] With DevTools Network panel blocking `/api/copilotkit-auth`, send a
      message while authenticated
- [ ] Verify a network-level error surfaces cleanly (no uncaught promise
      rejection in console)
- [ ] Restore network; verify sends work again without a page reload

## Expected Results

- Initial paint shows SignInCard (no 401 crash on `/info`)
- Banner state flips within 1s of Sign out / Sign in clicks
- Post-sign-out sends produce a visible 401 error within 15s via
  `auth-demo-error`
- Page never white-screens after sign out — banner and composer stay mounted
- Authenticated sends produce an assistant response within 30s
- Token persists across reloads via localStorage; clearing localStorage
  returns the demo to its first-paint SignInCard state
