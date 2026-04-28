# Authentication

## What This Demo Shows

Bearer-token gated CopilotKit runtime using the V2 runtime's `onRequest`
hook. The hook validates the `Authorization` header before the request
reaches the agent; mismatches short-circuit with a 401 Response. The
frontend toggles an in-memory auth flag and injects the matching header
via the provider's `headers` prop.

## How to Interact

1. The page starts in the unauthenticated state.
2. Type any message and send — the runtime returns 401, surfaced as an
   error banner below the chat.
3. Click "Authenticate" in the top banner.
4. Resend — the message now reaches the agent and you get a normal reply.
5. Click "Sign out" to revoke; the next message 401s again.

## Technical Details

**Provider headers** — `<CopilotKit headers={{ Authorization: "Bearer …" }}>`.
The provider reads headers reactively on every request via a
`[headers]`-keyed effect, so toggling in-memory auth state immediately
flips the outbound header without a reload.

**Runtime hook** — `createCopilotRuntimeHandler` from
`@copilotkit/runtime/v2` exposes the V2 handler directly so `hooks.onRequest`
is wired. The V1 Next.js adapter does not forward hooks, so this demo
bypasses it and returns the framework-agnostic fetch handler from the POST
and GET route exports.

**Throwing a Response** — the runtime maps thrown `Response` objects to
the HTTP response verbatim. That's the canonical way to short-circuit with
a status + JSON body from an `onRequest` hook.

**Shared backend** — the authenticated path proxies to the same MS Agent
Framework backend at `/` that other demos use. This demo is about the
gate, not a per-user agent.

**Shared demo token** — `demo-token.ts` is imported by both client and
server so the secret can't drift between the two halves of the demo.
Never do this in production — rotate tokens, use proper auth.

**Error banner** — `<CopilotChat>` surfaces transport errors
inconsistently across states, so the page also subscribes via
`<CopilotKit onError>` and renders a persistent `data-testid="auth-demo-error"`
banner below the chat. QA + Playwright have a stable target; users always
see the failure.
