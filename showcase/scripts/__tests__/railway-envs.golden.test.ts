/**
 * railway-envs.golden.test.ts — Behavior-preservation guard for the
 * railway-envs SSOT env-map refactor (Option C).
 *
 * This test serializes the FULLY-RESOLVED view of every service in every
 * env — exactly what the public accessors (instanceIdFor / domainFor /
 * repoNameFor) and the per-entry probe config return — into a single
 * canonical fixture (`fixtures/railway-envs.golden.json`).
 *
 * It is intentionally accessor-driven, NOT field-driven: it does not read
 * `entry.prodInstanceId` / `entry.domains.prod` / `entry.probe` directly.
 * It reads ONLY through the public resolution surface. That is the whole
 * point — the refactor swaps the internal `ServiceEntry` shape
 * (`prodInstanceId`/`stagingInstanceId`/`domains`/`probe`/`probeDriver`)
 * for a unified `environments` map, and this snapshot proves that for
 * every existing (service, env) pair the RESOLVED values are byte-identical
 * before and after. If the refactor changes any resolved instanceId,
 * domain, probe flag, driver, or repoName, this `toEqual` fails loud.
 *
 * The fixture is committed on the CURRENT (pre-refactor) schema and frozen.
 * The refactor must keep this green without touching the fixture.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SERVICES,
  domainFor,
  instanceIdFor,
  repoNameFor,
} from "../railway-envs";
import type { EnvName } from "../railway-envs";

const GOLDEN_PATH = resolve(
  __dirname,
  "fixtures",
  "railway-envs.golden.json",
);

const ENVS: EnvName[] = ["prod", "staging"];

/**
 * Resolve, for one (service, env) pair, the same projection the rest of
 * the tooling depends on — exclusively via the public accessors plus the
 * per-entry probe config that verify-deploy consumes. `domain` is captured
 * defensively (domainFor throws on a missing/scheme-bearing host, so we
 * record null on throw rather than aborting the whole snapshot — a service
 * that legitimately throws today must keep throwing after the refactor).
 */
function resolveServiceEnv(name: string, env: EnvName) {
  const entry = SERVICES[name];
  let domain: string | null;
  try {
    domain = domainFor(name, env);
  } catch {
    domain = null;
  }
  return {
    instanceId: instanceIdFor(name, env),
    domain,
    probe: entry.probe[env],
    driver: entry.probe.driver,
    repoName: repoNameFor(name, env),
  };
}

function buildSnapshot(): Record<
  string,
  Record<string, ReturnType<typeof resolveServiceEnv>>
> {
  const out: Record<
    string,
    Record<string, ReturnType<typeof resolveServiceEnv>>
  > = {};
  for (const name of Object.keys(SERVICES).sort()) {
    out[name] = {};
    for (const env of ENVS) {
      out[name][env] = resolveServiceEnv(name, env);
    }
  }
  return out;
}

describe("railway-envs golden snapshot (behavior-preservation guard)", () => {
  it("resolves every (service, env) pair byte-identically to the frozen fixture", () => {
    const actual = buildSnapshot();
    const expected = JSON.parse(readFileSync(GOLDEN_PATH, "utf8"));
    expect(actual).toEqual(expected);
  });
});
