import { describe, expect, it } from "vitest";

import {
  DEMO_AUTH_HEADER as CLIENT_DEMO_AUTH_HEADER,
  DEMO_TOKEN as CLIENT_DEMO_TOKEN,
} from "@/app/[integration]/demos/auth/demo-token";

import { DEMO_AUTH_HEADER, DEMO_TOKEN } from "./demo-auth-token";

/**
 * The `/auth` cell holds its token TWICE — this module for the server route,
 * and `src/app/[integration]/demos/auth/demo-token.ts` for the client. The
 * demo-folder copy is byte-identical to all 20 integration copies, so editing
 * it here would diverge it from twenty files; that, not any rule in
 * `showcase/AGENTS.md` (which has none on the subject), is why the
 * duplication stays. These assertions are
 * what makes the duplication safe: rotate one copy and the suite goes red
 * here, instead of every `/auth` cell on all 20 integrations going 401 in
 * production.
 */
describe("demo auth token", () => {
  it("matches the client copy the demo pages import", () => {
    expect(DEMO_TOKEN).toBe(CLIENT_DEMO_TOKEN);
  });

  it("derives the same Authorization header as the client copy", () => {
    expect(DEMO_AUTH_HEADER).toBe(CLIENT_DEMO_AUTH_HEADER);
    expect(DEMO_AUTH_HEADER).toBe(`Bearer ${DEMO_TOKEN}`);
  });
});
