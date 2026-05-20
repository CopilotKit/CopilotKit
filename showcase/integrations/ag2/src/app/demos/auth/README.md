# Authentication (AG2)

Bearer-token gate via the V2 runtime's `onRequest` hook. The runtime rejects
any request whose `Authorization` header doesn't match the demo bearer token
before the request reaches the AG2 ConversableAgent backend.

## Files

- `page.tsx` — `<CopilotKit headers={...}>` wires the bearer token; an error
  boundary keeps the page rendering when signed out.
- `auth-banner.tsx` — sign-in / sign-out toggle.
- `use-demo-auth.ts` — in-memory auth state hook.
- `demo-token.ts` — shared demo token constant.
- `../../api/copilotkit-auth/[[...slug]]/route.ts` — V2 runtime handler with
  the `onRequest` hook.

## Notes

The route uses `createCopilotRuntimeHandler` from `@copilotkit/runtime/v2`
because the V1 Next.js adapter does not forward the `hooks` option. The
shared default AG2 ConversableAgent backs the authenticated path.
