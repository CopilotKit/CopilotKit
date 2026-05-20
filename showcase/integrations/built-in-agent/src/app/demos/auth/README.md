# Authentication (built-in-agent)

Bearer-token gate on the V2 runtime via the `onRequest` hook. The hook
throws a `Response` with status 401 when the header is missing or invalid,
which the runtime maps to the HTTP response verbatim. The frontend toggles
an in-memory auth flag and the provider injects `Authorization: Bearer
<DEMO_TOKEN>` only while authenticated.

- Dedicated route: `/api/copilotkit-auth/[[...slug]]`
- Uses `useSingleEndpoint={false}` (multi-endpoint runtime)
- Key files: `page.tsx`, `use-demo-auth.ts`, `auth-banner.tsx`,
  `demo-token.ts`, `../../api/copilotkit-auth/[[...slug]]/route.ts`
