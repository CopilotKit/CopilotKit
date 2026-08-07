# QA: Authentication (OpenClaw)

Demo source: `src/app/demos/auth/page.tsx`
Route: `/demos/auth` · Agent: `auth-demo` · Runtime: `/api/copilotkit-auth`

## What it exercises

Framework-native request authentication via the V2 runtime's `onRequest` hook.
The dedicated runtime route (`/api/copilotkit-auth`) inspects the incoming
`Authorization` header and throws a `401` before the request ever reaches the
agent unless it exactly matches `Bearer demo-token-123` (`DEMO_TOKEN`). This is
a **frontend + runtime** demo — the gate lives in the Next.js route, so it has
**no ag-ui gateway dependency**. The `auth-demo` agent behind the gate is the
same stateless OpenClaw gateway agent every other demo proxies to; auth is about
whether the request is _allowed through_, not about any per-demo backend.

UX shape (differs from the Hermes/LangGraph reference): the demo defaults to
**unauthenticated on first paint** so a fresh visitor lands on a sign-in card.
`<CopilotKit>` is not mounted until the user signs in once — this sidesteps the
transport 401 that would otherwise crash `<CopilotChat>` during its initial
`/info` handshake. After the first sign-in, `<CopilotKit>` stays mounted across
the sign-out → sign-in cycle so the signed-out state can actually demonstrate
the runtime rejecting an unauthenticated request in the chat surface.

## Manual steps

1. **Fresh visitor — sign-in card.** Open the demo. Confirm the sign-in card
   renders (`data-testid="auth-sign-in-card"`), the demo token
   `demo-token-123` is shown in plain text (`data-testid="auth-demo-token"`),
   and there is no chat surface yet. No console errors.
2. **Sign in.** Click **"Sign in with demo token"**
   (`data-testid="auth-sign-in-button"`). Expect: `<CopilotKit>` mounts, the
   green banner appears (`data-testid="auth-banner"`, `data-authenticated="true"`,
   status "✓ Signed in as demo user"), and `<CopilotChat>` renders below it.
   The `/info` handshake succeeds (no 401 in the console).
3. **Authenticated send.** Type **"Hello"** and send. Within ~30s an assistant
   response streams into the transcript. No error surface appears
   (`data-testid="auth-demo-error"` absent).
4. **Sign out flips the banner and surfaces 401 without crashing.** Click
   **"Sign out"**. The banner flips to amber (`data-authenticated="false"`,
   status "⚠ Signed out — the agent will reject your messages until you sign
   in.") and the "Sign in" button appears (`data-testid="auth-authenticate-button"`).
   Send **"Hello again"**. Within ~15s the page-level error surface appears
   (`data-testid="auth-demo-error"`) with a message and a `401`/unauthorized
   code. The banner and composer stay mounted — the page must **not**
   white-screen — and no assistant response is produced for that send.
5. **Sign back in clears the error.** Click **"Sign in"**. The banner flips
   back to green, the amber error surface clears, and a fresh **"Hello"** send
   gets an assistant response again (~30s).
6. **Reload resets to the sign-in card.** Hard-reload the page. Because the
   demo defers localStorage hydration to `useEffect`, first paint is
   unauthenticated → the sign-in card returns. (The stored token then
   re-hydrates, so a subsequent interaction can be authenticated.)

## Assertion bar

- First paint is the sign-in card, not a live chat — no 401 crash on initial load.
- Banner flips within ~1s of Sign out / Sign in clicks.
- A signed-out send produces a **visible** `401` via `auth-demo-error` within
  ~15s; no assistant response for that send.
- The page never white-screens after sign-out — banner + composer stay mounted.
- An authenticated send produces an assistant response within ~30s.

## Protocol-level check (no browser)

The gate is enforced by the Next.js runtime route, not the gateway, so verify it
directly against `/api/copilotkit-auth`:

- POST with no `Authorization` header (or a wrong token) → expect HTTP `401`
  with a JSON body `{ "error": "unauthorized", ... }`; the request never reaches
  the OpenClaw agent.
- POST the same request with `Authorization: Bearer demo-token-123` → expect the
  gate to pass and the run to proceed to the gateway.

## Caveats

- `demo-token-123` is a hard-coded shared secret for demonstration only. Real
  apps must issue per-user tokens via an identity provider — never hard-code a
  shared secret or store real bearer tokens in localStorage.
- The runtime gate compares against the fixed token, so any other string signs
  in on the UI but is rejected by the runtime on the next send (validation is
  the runtime's job; the UI just owns which header is sent).
- This runtime uses the V2 multi-endpoint protocol (`useSingleEndpoint={false}`).
