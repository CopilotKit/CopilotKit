# QA: Authentication — CrewAI (Crews)

- [ ] Navigate to `/demos/auth`. The page mounts authenticated by default so the initial `/info` handshake succeeds without crashing the route.
- [ ] Verify the auth banner (`data-testid="auth-banner"`) shows `data-authenticated="true"` and the "Sign out" button is visible.
- [ ] Send a message; verify the agent responds normally (no error banner).
- [ ] Click "Sign out"; verify the banner flips to `data-authenticated="false"` and the "Sign in" button is visible.
- [ ] Send a new message; verify the error banner (`data-testid="auth-demo-error"`) appears with a 401 message. The `ChatErrorBoundary` should keep the rest of the page rendered (no white screen) — boundary fallback (`data-testid="auth-demo-chat-boundary"`) may appear inside the chat container.
- [ ] Click "Sign in"; verify the banner flips back to authenticated, the error banner clears, and the chat is usable again without a page reload.
