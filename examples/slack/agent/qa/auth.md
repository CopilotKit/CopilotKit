# QA: Authentication — LangGraph (Python)

## Prerequisites

- Demo deployed and accessible at /demos/auth
- Railway service `showcase-langgraph-python` healthy
- OPENAI_API_KEY set on Railway

## Test Steps

### 1. Initial authenticated state

- [ ] Navigate to /demos/auth
- [ ] Verify the banner is visible with a green/success appearance (data-testid="auth-banner", data-authenticated="true")
- [ ] Verify auth-status text reads "✓ Signed in as demo user"
- [ ] Verify the "Sign out" button is visible and enabled (data-testid="auth-sign-out-button")
- [ ] Verify the "Sign in" button is NOT present
- [ ] Verify <CopilotChat /> is mounted below the banner
- [ ] Verify no auth-demo-error surface is shown (data-testid="auth-demo-error" absent)
- [ ] Verify no console errors on page load (the `/info` handshake should succeed)

### 2. Authenticated send → assistant response

- [ ] Type "Hello" and click send
- [ ] Within 30 seconds, an assistant response is rendered in the transcript
- [ ] No auth-demo-error surface appears

### 3. Sign out flips the banner and surfaces 401 without crashing

- [ ] Click "Sign out"
- [ ] Within 1 second, the banner flips to amber/warning appearance (data-authenticated="false")
- [ ] Verify auth-status text reads "⚠ Signed out — the agent will reject your messages until you sign in."
- [ ] Verify the "Sign in" button is visible (data-testid="auth-authenticate-button")
- [ ] Verify the "Sign out" button is no longer present
- [ ] Type "Hello again" and click send
- [ ] Within 15 seconds, the page-level error surface appears:
  - `data-testid="auth-demo-error"` visible with text containing "401" and/or "Unauthorized"
- [ ] Verify the banner is STILL visible — the page must not white-screen
- [ ] Verify no assistant response appears for the unauthenticated send

### 4. Sign in clears the error and restores sends

- [ ] Click "Sign in"
- [ ] Within 1 second, the banner flips back to green (data-authenticated="true")
- [ ] Verify the auth-demo-error surface is cleared
- [ ] Type "Hello" and click send
- [ ] Within 30 seconds, an assistant response is rendered

### 5. Refresh resets state to authenticated

- [ ] Hard-reload the page
- [ ] Banner is green on first render (default state is authenticated; state does NOT persist)
- [ ] No error surface on first render

### 6. Error Handling

- [ ] With DevTools Network panel blocking /api/copilotkit-auth, send a message while authenticated
- [ ] Verify a network-level error surfaces cleanly (no uncaught promise rejection in console)
- [ ] Restore network; verify sends work again without a page reload

## Expected Results

- Page loads authenticated by default — no 401 crash on initial `/info` fetch
- Banner state flips within 1s of Sign out / Sign in clicks
- Post-sign-out sends produce a visible 401 error within 15s via auth-demo-error
- Page never white-screens after sign out — banner and composer remain mounted
- Authenticated sends produce an assistant response within 30s
- Refresh fully resets auth state (back to authenticated)
