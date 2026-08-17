/**
 * Demo-token constant for the `/auth` cell, used by the SERVER side only:
 * `src/app/api/[integration]/auth/[[...slug]]/route.ts` is its one importer.
 *
 * THERE ARE TWO COPIES OF THIS TOKEN, AND THIS FILE IS NOT THE ONLY ONE.
 * The client half of the cell — `sign-in-card.tsx`, `page.tsx` and
 * `use-demo-auth.ts` — imports a SECOND definition at
 * `src/app/[integration]/demos/auth/demo-token.ts`. That file is a verbatim
 * port: it is byte-identical (sha256-verified) to all 20 copies under
 * `showcase/integrations/<slug>/src/app/demos/auth/demo-token.ts`. Editing
 * the ported copy would diverge it from those twenty, which is the drift
 * this arrangement exists to avoid, and this file cannot import it either
 * without dragging a demo-folder module into the API route. So the
 * duplicate stays.
 *
 * NO GOVERNANCE RULE IS BEING CITED HERE, and an earlier version of this
 * comment did cite one: it claimed `showcase/AGENTS.md` forbids editing
 * ported demo folders. It does not — that file's four iron rules cover
 * shared probes, near-identical frontends, minimal backends and
 * fixture-only variation, and contain no such prohibition. The reason to
 * leave the copy alone is the twenty-way byte-identity above, which is
 * checkable, not a rule that has to be taken on trust.
 *
 * CHANGE BOTH FILES TOGETHER. Rotating the token in one place alone makes
 * every `/auth` cell on all 20 integrations answer 401. The upstream copies
 * must move with them, or the ported file stops being verbatim.
 *
 * `demo-auth-token.test.ts` asserts the two constants are equal, so drift
 * turns the suite red instead of turning the cells red.
 *
 * This is a DEMO token. Never use a hard-coded shared secret for real auth.
 */
export const DEMO_TOKEN = "demo-token-123";

export const DEMO_AUTH_HEADER = `Bearer ${DEMO_TOKEN}`;
