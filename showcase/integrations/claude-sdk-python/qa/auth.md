# QA: Authentication — Claude Agent SDK (Python)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)
- `ANTHROPIC_API_KEY` is set on the deployment

## Test Steps

### 1. Basic Functionality (happy path — start signed in)

- [ ] Navigate to `/demos/auth`
- [ ] Verify the auth banner renders with
      `data-authenticated="true"`
- [ ] Verify the status reads "✓ Signed in as demo user"
- [ ] Verify the "Sign out" button is visible
- [ ] Send "Hello" and verify Claude responds

### 2. Sign-out path

- [ ] Click "Sign out"
- [ ] Verify the banner flips to amber with
      `data-authenticated="false"`
- [ ] Verify the button now reads "Sign in"
- [ ] Attempt to send a message
- [ ] Verify the error banner (`data-testid="auth-demo-error"`)
      renders with "401 Unauthorized" text
- [ ] Verify no white-screen and no uncaught React errors (the
      ChatErrorBoundary catches any render-time crash from chat
      internals in the unauth state and renders
      `data-testid="auth-demo-chat-boundary"`)

### 3. Sign-in recovery

- [ ] Click "Sign in"
- [ ] Verify the banner flips back to green
- [ ] Verify the error banner clears
- [ ] Send a message and verify Claude replies again

### 4. Error Handling

- [ ] No console errors during normal usage.

## Expected Results

- Runtime rejects un-bearer'd requests with HTTP 401.
- Page never white-screens, even during auth transitions.
