// The auth demo's token. The demo page sends it, and the auth runtime route
// (src/app/api/[integration]/auth) accepts only requests that carry it.
//
// This is a demo token. Never use a hard-coded shared secret for real auth.

/** The token that the auth demo's sign-in button uses. */
export const DEMO_TOKEN = "demo-token-123";

/** The `Authorization` header value that the auth runtime route requires. */
export const DEMO_AUTH_HEADER = `Bearer ${DEMO_TOKEN}`;
