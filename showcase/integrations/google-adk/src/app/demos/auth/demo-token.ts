/**
 * Shared demo-token constant imported by both the client (`./page.tsx`)
 * and the server runtime route (`api/copilotkit-auth/route.ts`). Keeping
 * the constant in one file prevents drift: changing the token in one
 * place changes it everywhere.
 *
 * This is a DEMO token. Never use a hard-coded shared secret for real
 * auth — and note that any non-`"server-only"` module is client-visible,
 * so this constant ships into the browser bundle as part of the demo.
 */
export const DEMO_TOKEN = "demo-token-123";

export const DEMO_AUTH_HEADER = `Bearer ${DEMO_TOKEN}`;
