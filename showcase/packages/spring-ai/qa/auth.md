# QA: Authentication — Spring AI

## Prerequisites

- Demo is deployed and accessible

## Test Steps

- [ ] Navigate to `/demos/auth`
- [ ] Verify the auth banner shows "Not authenticated"
- [ ] Attempt to send a message
- [ ] Verify a 401 error is surfaced (auth-demo-error banner)
- [ ] Click Authenticate
- [ ] Verify the banner flips to the authenticated state
- [ ] Send a message and verify the agent responds

## Expected Results

- Unauthenticated requests are rejected at the runtime via onRequest hook
- Authenticated requests reach the agent and succeed
