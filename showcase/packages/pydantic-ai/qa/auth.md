# QA: Authentication — PydanticAI

## Prerequisites

- Demo deployed and accessible at `/demos/auth`
- Agent backend healthy (check `/api/health`)
- `OPENAI_API_KEY` set

## Test Steps

### 1. Initial authenticated state

- [ ] Navigate to `/demos/auth`
- [ ] Banner visible with green/success appearance
      (`data-testid="auth-banner"`, `data-authenticated="true"`)
- [ ] Status text reads "✓ Signed in as demo user"
- [ ] "Sign out" button visible and enabled
- [ ] "Sign in" button is NOT present
- [ ] `<CopilotChat />` is mounted below the banner
- [ ] No `auth-demo-error` surface visible
- [ ] No console errors on page load (the `/info` handshake succeeds)

### 2. Authenticated send

- [ ] Type "Hello" and send
- [ ] Within 30 seconds, an assistant response renders
- [ ] No `auth-demo-error` surface appears

### 3. Sign out → 401

- [ ] Click "Sign out"
- [ ] Within 1 second, banner flips to amber/warning
      (`data-authenticated="false"`)
- [ ] Status text reads "⚠ Signed out — the agent will reject your
      messages until you sign in."
- [ ] "Sign in" button visible; "Sign out" button gone
- [ ] Type "Hello again" and send
- [ ] Within 15 seconds, `auth-demo-error` surface appears with text
      containing "401" and/or "Unauthorized"
- [ ] Banner still visible — the page must NOT white-screen

### 4. Sign in → recovery

- [ ] Click "Sign in"
- [ ] Banner flips back to green
- [ ] `auth-demo-error` surface clears
- [ ] Send "Hello" → assistant response renders within 30 seconds

### 5. Refresh resets state

- [ ] Hard-reload the page
- [ ] Banner is green on first render (default state is authenticated)

## PydanticAI-specific note

The auth gate is framework-agnostic — `createCopilotRuntimeHandler` from
`@copilotkit/runtime/v2` supports the `onRequest` hook regardless of the
underlying agent framework. The gate throws a 401 Response before the
request reaches the PydanticAI backend.

## Expected Results

- Page loads authenticated by default — no 401 crash on initial `/info`
  fetch.
- Post-sign-out sends produce a visible 401 via the page-level error
  surface.
- Page never white-screens after sign out; banner and composer stay
  mounted (guarded by `ChatErrorBoundary`).
- Authenticated sends produce responses within 30s.
