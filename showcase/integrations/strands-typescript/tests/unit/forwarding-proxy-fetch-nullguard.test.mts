/**
 * Regression test for the `forwardingProxyFetch` null-guard
 * (src/app/api/copilotkit/route.ts).
 *
 * This integration has no vitest/jest harness (only Playwright e2e + the
 * tsx-run Express agent sub-package), so this is a self-contained tsx test:
 *
 *     node --import tsx tests/unit/forwarding-proxy-fetch-nullguard.test.mts
 *
 * Bug: `forwardingProxyFetch` accessed `requestInit.headers` and spread
 * `...requestInit` with NO null-guard. When invoked with no/undefined init
 * while inbound x-* headers were in the AsyncLocalStorage scope, it threw
 * `TypeError: Cannot read properties of undefined (reading 'headers')`. Its
 * agent-side sibling `forwardingFetch` (src/agent/header-forwarding.ts) was
 * already null-safe via `init?.headers`. The fix makes the proxy hop match:
 * `new Headers(requestInit?.headers)`.
 *
 * Two guards:
 *   1. BEHAVIORAL — replicates the route's ALS + merge logic and proves the
 *      no-init-call-with-headers-in-scope path merges headers without throwing
 *      (and that the pre-fix logic throws, locking in the red->green).
 *   2. SOURCE — asserts the real route.ts source uses the guarded
 *      `requestInit?.headers` form, so a regression to `requestInit.headers`
 *      fails this test.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const proxyHeaders = new AsyncLocalStorage<Record<string, string>>();

// Stub fetch so the test makes no real network call; capture the init it
// receives so we can assert the merged headers.
const captureFetch = async (_url: unknown, init?: { headers?: HeadersInit }) =>
  ({ __init: init }) as unknown as Response;

// PRE-FIX logic (the bug) — verbatim from the unguarded route.ts.
const preFix = (url: string, requestInit?: RequestInit) => {
  const forwarded = proxyHeaders.getStore() ?? {};
  if (Object.keys(forwarded).length === 0)
    return captureFetch(url, requestInit);
  // @ts-expect-error reproducing the unguarded access on purpose
  const merged = new Headers(requestInit.headers);
  for (const [k, v] of Object.entries(forwarded))
    if (!merged.has(k)) merged.set(k, v);
  return captureFetch(url, { ...requestInit, headers: merged });
};

// POST-FIX logic — null-safe, matching the sibling forwardingFetch.
const postFix = (url: string, requestInit?: RequestInit) => {
  const forwarded = proxyHeaders.getStore() ?? {};
  if (Object.keys(forwarded).length === 0)
    return captureFetch(url, requestInit);
  const merged = new Headers(requestInit?.headers);
  for (const [k, v] of Object.entries(forwarded))
    if (!merged.has(k)) merged.set(k, v);
  return captureFetch(url, { ...requestInit, headers: merged });
};

async function callWithHeadersInScopeNoInit(
  fn: (u: string, i?: RequestInit) => Promise<Response>,
): Promise<Headers> {
  return proxyHeaders.run(
    { "x-aimock-strict": "1", "x-test-id": "t42" },
    async () => {
      // The failure surface: called with NO second arg.
      const res = (await fn("http://localhost:8000/")) as unknown as {
        __init: { headers: Headers };
      };
      return res.__init.headers;
    },
  );
}

let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (cond) {
    console.log(`  ok - ${msg}`);
  } else {
    failures++;
    console.error(`  FAIL - ${msg}`);
  }
};

// 1. Red lock: the pre-fix logic MUST throw on no-init-with-headers.
let threw = false;
try {
  await callWithHeadersInScopeNoInit(preFix);
} catch (e) {
  threw = e instanceof TypeError;
}
check(threw, "pre-fix logic throws TypeError (bug reproduces)");

// 2. Green: the post-fix logic merges headers without throwing.
const merged = await callWithHeadersInScopeNoInit(postFix);
check(
  merged.get("x-aimock-strict") === "1",
  "post-fix merges x-aimock-strict when called with no init",
);
check(
  merged.get("x-test-id") === "t42",
  "post-fix merges x-test-id when called with no init",
);

// 3. Source guard: the real route uses the guarded form.
const here = dirname(fileURLToPath(import.meta.url));
const routeSrc = readFileSync(
  resolve(here, "../../src/app/api/copilotkit/route.ts"),
  "utf8",
);
check(
  routeSrc.includes("new Headers(requestInit?.headers)"),
  "route.ts uses guarded new Headers(requestInit?.headers)",
);
check(
  !/new Headers\(requestInit\.headers\)/.test(routeSrc),
  "route.ts does not use unguarded new Headers(requestInit.headers)",
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
