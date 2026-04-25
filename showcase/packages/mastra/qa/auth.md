# QA: Authentication — Mastra

## Test Steps

- [ ] Navigate to `/demos/auth`
- [ ] Verify the page loads with banner showing "✓ Signed in as demo user" (green)
- [ ] Verify `<CopilotChat />` renders and accepts input
- [ ] Send any message — verify the agent responds
- [ ] Click "Sign out" — banner flips to amber "Signed out — the agent will reject your messages…"
- [ ] Try to send a new message — verify the error banner at bottom shows "401 Unauthorized"
- [ ] Click "Sign in" — banner turns green again, error banner clears
- [ ] Verify sending messages works again

## Expected Results

- `Authorization: Bearer demo-token-123` header injected via `<CopilotKit headers={...}>` when signed in
- `/api/copilotkit-auth` route uses V2 runtime `onRequest` hook to throw a 401 Response when header missing
- `ChatErrorBoundary` auto-resets on sign-in so the chat remounts cleanly
- Page starts authenticated to avoid the initial `/info` 401 crash

## Implementation

- Route: `src/app/api/copilotkit-auth/route.ts` (V2 `createCopilotRuntimeHandler` with `hooks.onRequest`)
- Token constant: `src/app/demos/auth/demo-token.ts`
- Auth state: `src/app/demos/auth/use-demo-auth.ts` (default `authenticated: true`)
- Banner: `src/app/demos/auth/auth-banner.tsx`
