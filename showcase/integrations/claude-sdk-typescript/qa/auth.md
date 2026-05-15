# QA: Authentication — Claude Agent SDK (TypeScript)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy

## Test Steps

### 1. Initial state

- [ ] Navigate to `/demos/auth`
- [ ] Verify the banner says "Signed in as demo user" (default = authenticated)
- [ ] Verify the "Sign out" button is visible
- [ ] Send a message, verify Claude responds

### 2. Unauthenticated path

- [ ] Click "Sign out"
- [ ] Verify the banner flips to "Signed out"
- [ ] Send a message
- [ ] Verify a visible 401 error banner appears below the chat with an actionable message
- [ ] Verify the page does NOT white-screen — the chat area shows the error boundary fallback

### 3. Recovery

- [ ] Click "Sign in"
- [ ] Verify the banner returns to "Signed in as demo user"
- [ ] Send a new message
- [ ] Verify the chat works normally again

## Expected Results

- Chat loads without crash when starting unauthenticated (if navigated by URL)
- 401 surfaces via in-page banner, not console-only
- ChatErrorBoundary catches render errors from unauthenticated state
