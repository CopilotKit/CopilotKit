# Authentication (built-in-agent)

Bearer-token gate on the V2 runtime via the `onRequest` hook. The hook
throws a `Response` with status 401 when the header is missing or invalid,
which the runtime maps to the HTTP response verbatim. The frontend defaults
to UNAUTHENTICATED on first paint (SignInCard); after sign-in the provider
injects `Authorization: Bearer <DEMO_TOKEN>` and the chat stays mounted
across the sign-out → sign-in cycle so the post-sign-out 401 is surfaced in
the chat (amber `auth-demo-error` banner) rather than bouncing back to the
gate. The 401 is captured via the agent-scoped `<CopilotChat onError>`
channel (and the provider-level `onError` for handshake errors).

- Dedicated route: `/api/copilotkit-auth/[[...slug]]`
- Uses `useSingleEndpoint={false}` (multi-endpoint runtime)
- Mounts `<CopilotKitProvider>` (built-in agent under the default key)
  rather than `<CopilotKit agent="...">` — a forced provider divergence from
  the langgraph-python gold reference; the error-handling shape, auth hook,
  and testid contract match.
- Key files: `page.tsx`, `use-demo-auth.ts`, `auth-banner.tsx`,
  `sign-in-card.tsx`, `demo-token.ts`,
  `../../api/copilotkit-auth/[[...slug]]/route.ts`
