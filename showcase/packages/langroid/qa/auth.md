# QA: Authentication — Langroid

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)
- The route `/api/copilotkit-auth` rejects requests missing the Bearer header

## Test Steps

### 1. Unauthenticated state

- [ ] Navigate to `/demos/auth`
- [ ] Verify `data-testid="auth-banner"` reads `data-authenticated="false"`
- [ ] Verify the banner shows "Authenticate" button
- [ ] Send a message in the chat
- [ ] Verify `data-testid="auth-demo-error"` appears with a 401 message

### 2. Authenticated state

- [ ] Click `data-testid="auth-authenticate-button"`
- [ ] Verify the banner flips to `data-authenticated="true"`
- [ ] Verify the error banner clears
- [ ] Send a message and verify the Langroid agent responds
- [ ] Click Sign out and verify the banner flips back to unauthenticated
