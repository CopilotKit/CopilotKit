/**
 * Shared demo-token constant imported by both the client
 * (use-demo-auth.ts) and the server runtime route
 * (api/copilotkit-auth/route.ts). Keeping the constant in one file
 * prevents drift.
 *
 * This is a DEMO token. Never use a hard-coded shared secret for real auth.
 */
export const DEMO_TOKEN = "demo-token-123";

export const DEMO_AUTH_HEADER = `Bearer ${DEMO_TOKEN}`;
