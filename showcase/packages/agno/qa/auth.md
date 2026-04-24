# QA: Authentication — Agno

## Prerequisites

- Demo deployed at `/demos/auth`
- Dedicated runtime at `/api/copilotkit-auth`
- Agno main agent backend healthy at `/agui`

## Test Steps

### 1. Basic Functionality (unauthenticated)

- [ ] Navigate to `/demos/auth`
- [ ] Verify the amber banner (`data-testid="auth-banner"`,
      `data-authenticated="false"`) shows "⚠ Not authenticated …"
- [ ] Send any message
- [ ] Verify the chat fails with a 401 and the error banner
      (`data-testid="auth-demo-error"`) shows
      "401 Unauthorized — click Authenticate above…"

### 2. Authenticate

- [ ] Click the "Authenticate" button
- [ ] Verify the banner switches to emerald/green, shows
      "✓ Authenticated as demo user", and `data-authenticated="true"`
- [ ] Verify any stale error banner is cleared
- [ ] Send a message (e.g. "What's the weather in Tokyo?")
- [ ] Verify the agent responds normally (runtime gate passes)

### 3. Sign out

- [ ] Click "Sign out"
- [ ] Verify the banner reverts to amber / unauthenticated
- [ ] Send another message and verify the 401 path resurfaces

### 4. Error Handling

- [ ] No uncaught console errors
