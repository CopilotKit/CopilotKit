# QA: Authentication — LangGraph (Python)

## Prerequisites

- Demo deployed and accessible at /demos/auth
- Railway service `showcase-langgraph-python` healthy
- OPENAI_API_KEY set on Railway

## Test Steps

### 1. Initial unauthenticated state

- [ ] Navigate to /demos/auth
- [ ] Verify the banner is visible with an amber/warning appearance (data-testid="auth-banner", data-authenticated="false")
- [ ] Verify auth-status text reads "⚠ Not authenticated — the agent will reject your messages."
- [ ] Verify the "Authenticate" button is visible and enabled (data-testid="auth-authenticate-button")
- [ ] Verify the "Sign out" button is NOT present
- [ ] Verify <CopilotChat /> is mounted below the banner
- [ ] Verify no auth-demo-error surface is shown yet (data-testid="auth-demo-error" absent)

### 2. Unauthenticated send → 401

- [ ] Type "Hello" and click send
- [ ] Within 15 seconds, the page-level error surface appears:
  - `data-testid="auth-demo-error"` visible with text containing "401" and/or "Unauthorized"
- [ ] Verify no assistant response appears in the transcript

### 3. Authenticate flips the banner and enables sends

- [ ] Click "Authenticate"
- [ ] Within 1 second, the banner flips to green/success appearance (data-authenticated="true")
- [ ] Verify auth-status text reads "✓ Authenticated as demo user"
- [ ] Verify the "Sign out" button is visible (data-testid="auth-sign-out-button")
- [ ] Verify the "Authenticate" button is no longer present
- [ ] Verify the auth-demo-error surface is cleared on authenticate
- [ ] Type "Hello" and click send
- [ ] Within 15 seconds, an assistant response is rendered in the transcript

### 4. Sign out reverts behavior

- [ ] Click "Sign out"
- [ ] Banner flips back to amber within 1 second
- [ ] Previous transcript (assistant replies from authenticated state) remains visible
- [ ] Type "Hello again" and send
- [ ] Within 15 seconds, the auth-demo-error surface reappears for the new send

### 5. Refresh resets state

- [ ] Hard-reload the page
- [ ] Banner is amber on first render (state does NOT persist)
- [ ] No error surface on first render

### 6. Error Handling

- [ ] With DevTools Network panel blocking /api/copilotkit-auth, send a message while authenticated
- [ ] Verify a network-level error surfaces cleanly (no uncaught promise rejection in console)
- [ ] Restore network; verify sends work again without a page reload

## Expected Results

- Banner state flips within 1s of Authenticate / Sign out clicks
- Unauthenticated sends produce a visible 401 error within 15s via auth-demo-error
- Authenticated sends produce an assistant response within 15s
- No console errors during successful flows
- Refresh fully resets auth state
