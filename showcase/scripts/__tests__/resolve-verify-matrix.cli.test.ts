/**
 * resolve-verify-matrix.cli.test.ts — pins the byte-for-byte $GITHUB_OUTPUT
 * contract that showcase_deploy.yml depends on.
 *
 * The deploy workflow's `verify:` job has
 *   if: needs.resolve-matrix.outputs.has_services == 'true'
 * which compares against the LITERAL strings 'true'/'false' (everything in
 * $GITHUB_OUTPUT is a string). A regression that writes `has_services=1`
 * or `has_services=True` would silently skip verify on every redeploy.
 * Pin that contract here so the byte-for-byte format is part of the test
 * surface, not just the pure-function unit tests.
 *
 * The pure resolver is covered by resolve-verify-matrix.test.ts. THIS
 * file spawns the CLI as a child process against the real
 * railway-envs.generated.json so the loader + parseSsotServices +
 * writeGithubOutput contract gets end-to-end coverage.
 *
 * Cases (mirrors decision-table boundaries the workflow YAML depends on):
 *   1. workflow_run + SUMMARY_PRESENT=true + OK_FROM_REDEPLOY=""
 *        → services_csv=\nhas_services=false\n      [Issue A pinned end-to-end]
 *   2. workflow_run + SUMMARY_PRESENT=true + OK_FROM_REDEPLOY="<two real names>"
 *        → services_csv=<sorted CSV>\nhas_services=true\n
 *   3. workflow_dispatch + no summary → full probe-eligible set, has_services=true.
 *   4. workflow_dispatch + service=<unknown> → non-zero exit, stderr ::error::Unknown service.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// The repo root is the cwd the workflow YAML uses for the script (paths
// inside the script are written as `showcase/scripts/...`, relative to
// repo root). Tests therefore must spawn from repo root.
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const SCRIPT = "showcase/scripts/resolve-verify-matrix.ts";
const SSOT_PATH = join(
  REPO_ROOT,
  "showcase/scripts/railway-envs.generated.json",
);

interface SpawnResult {
  status: number;
  stderr: string;
  output: string;
}

function runCli(env: Record<string, string>): SpawnResult {
  const dir = mkdtempSync(join(tmpdir(), "rvm-cli-"));
  const outputPath = join(dir, "gh_output");
  writeFileSync(outputPath, "");
  const fullEnv = {
    ...process.env,
    GITHUB_OUTPUT: outputPath,
    ...env,
  };
  // spawnSync (rather than execFileSync) so we capture stderr on BOTH
  // zero and non-zero exit. execFileSync exposes stderr only on throw,
  // which means the ::warning:: drift path (exit 0 + stderr text) is
  // invisible to the test harness. spawnSync returns a single object
  // regardless of status, so we inspect `status` and `stderr` directly.
  const res = spawnSync("npx", ["tsx", SCRIPT], {
    cwd: REPO_ROOT,
    env: fullEnv,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf-8",
  });
  return {
    status: typeof res.status === "number" ? res.status : 1,
    stderr: typeof res.stderr === "string" ? res.stderr : "",
    output: readFileSync(outputPath, "utf-8"),
  };
}

// Pull two real probe-eligible names off the actual SSOT so the test
// stays in lock-step with the emitter (rather than hard-coding fixtures
// that could drift).
function realProbeEligibleNames(): string[] {
  const raw = JSON.parse(readFileSync(SSOT_PATH, "utf-8")) as {
    services: { name: string; probe: { staging: boolean } }[];
  };
  return raw.services
    .filter((s) => s.probe.staging === true)
    .map((s) => s.name)
    .sort();
}

describe("resolve-verify-matrix CLI (end-to-end against real SSOT)", () => {
  // The CLI spawns `npx tsx`. Cold-start can take >1s; bump timeout.
  it("workflow_run + summary_present + empty ok_services → has_services=false (Issue A end-to-end)", () => {
    const r = runCli({
      EVENT_NAME: "workflow_run",
      SUMMARY_PRESENT: "true",
      OK_FROM_REDEPLOY: "",
      DISPATCH_SERVICE: "",
    });
    expect(r.status).toBe(0);
    // Byte-for-byte: the workflow YAML compares against the literal
    // strings 'true' / 'false'. Match the EXACT bytes (including the
    // trailing newlines and key=value form).
    expect(r.output).toBe("services_csv=\nhas_services=false\n");
  }, 30_000);

  it("workflow_run + summary_present + two real ok_services → sorted CSV + has_services=true", () => {
    // Hard-code two real, stable probe-eligible SSOT names rather than
    // picking probe[0]/probe[1] off the live list. The earlier
    // probe-index version was tautological: it pulled sorted names from
    // the SSOT, reversed them, fed them back, and asserted the resolver
    // re-sorted to the same order — which would silently pass even on a
    // resolver that did nothing (because probe[0] < probe[1] is the
    // ALREADY-sorted SSOT order). Also: if the SSOT ever shrank to <2
    // probe-eligible entries, the test would silently assert
    // `services_csv=undefined,undefined`.
    //
    // `aimock` and `harness` are foundational infra services (not
    // integration slots), so they will not churn out of the SSOT. We
    // assert they're both still probe-eligible at runtime; if either
    // ever leaves, this test fails LOUD with a specific message rather
    // than silently degrading.
    const probe = new Set(realProbeEligibleNames());
    expect(probe.has("aimock")).toBe(true);
    expect(probe.has("harness")).toBe(true);
    // Feed unsorted so the sort-on-intersection assertion is real:
    // "harness,aimock" must come out as "aimock,harness".
    const r = runCli({
      EVENT_NAME: "workflow_run",
      SUMMARY_PRESENT: "true",
      OK_FROM_REDEPLOY: "harness,aimock",
      DISPATCH_SERVICE: "",
    });
    expect(r.status).toBe(0);
    expect(r.output).toBe("services_csv=aimock,harness\nhas_services=true\n");
  }, 30_000);

  // -----------------------------------------------------------------------
  // FIX 3 — surface SSOT/build drift via ::warning::ok_services tokens
  // dropped (no SSOT match). The intersection logic already silently drops
  // unmatched tokens from the verify matrix; the WARNING is the entire
  // drift-detection contract operators rely on to notice that a redeploy
  // reported success for a service the SSOT has forgotten about (or vice
  // versa). Without coverage here it could silently regress to "no warning
  // emitted" and the gate would keep working while losing its early-warning
  // signal.
  // -----------------------------------------------------------------------
  it("workflow_run + ok_services with bogus token → ::warning:: lists dropped tokens, real ones still verify", () => {
    const r = runCli({
      EVENT_NAME: "workflow_run",
      SUMMARY_PRESENT: "true",
      // `svc-bogus` is not in the SSOT under any spelling; `aimock` is
      // a real probe-eligible service. The verify CSV must drop the
      // bogus token AND the wrapper must `::warning::` so the dropped
      // token surfaces in the workflow log as an annotation.
      OK_FROM_REDEPLOY: "svc-bogus,aimock",
      DISPATCH_SERVICE: "",
    });
    expect(r.status).toBe(0);
    expect(r.output).toContain("services_csv=aimock\n");
    expect(r.output).toContain("has_services=true\n");
    expect(r.stderr).toMatch(
      /::warning::ok_services tokens dropped \(no SSOT match\): svc-bogus/,
    );
  }, 30_000);

  // -----------------------------------------------------------------------
  // FIX 5 — EVENT_NAME must be exactly 'workflow_run' or 'workflow_dispatch'.
  // The CLI used to do an unchecked `as` cast on EVENT_NAME, so a typo or
  // accidental new trigger ('push', 'schedule') would compile-pass at the
  // type layer and only fail deep inside the resolver. Make the boundary
  // total: a narrowing helper rejects unknown EVENT_NAME values up front,
  // matching the resolver's own runtime guard with a SINGLE consistent
  // story (type system + runtime agree).
  // -----------------------------------------------------------------------
  it("EVENT_NAME=push → non-zero exit with ::error::resolve-verify-matrix: unexpected EVENT_NAME", () => {
    const r = runCli({
      EVENT_NAME: "push",
      SUMMARY_PRESENT: "",
      OK_FROM_REDEPLOY: "",
      DISPATCH_SERVICE: "",
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(
      /::error::resolve-verify-matrix: unexpected EVENT_NAME 'push'/,
    );
  }, 30_000);

  // -----------------------------------------------------------------------
  // FIX 7 — workflow_run requires SUMMARY_PRESENT to be exactly "true" or
  // "false". The check-redeploy-summary step always sets one of those two
  // values, so any other input (including "" from a step-id wiring break,
  // or "True" from a case-typo) means the wiring is broken and the gate
  // would silently fall through to the intersection branch. Fail loud
  // rather than silently emitting has_services=false on a real redeploy.
  // workflow_dispatch ignores SUMMARY_PRESENT and must NOT trigger this.
  // -----------------------------------------------------------------------
  it("EVENT_NAME=workflow_run + SUMMARY_PRESENT='' → non-zero exit with workflow_run requires summary_present", () => {
    const r = runCli({
      EVENT_NAME: "workflow_run",
      SUMMARY_PRESENT: "",
      OK_FROM_REDEPLOY: "",
      DISPATCH_SERVICE: "",
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(
      /::error::resolve-verify-matrix: workflow_run requires summary_present in \{true,false\}, got ''/,
    );
  }, 30_000);

  it("EVENT_NAME=workflow_run + SUMMARY_PRESENT='True' (case typo) → non-zero exit", () => {
    const r = runCli({
      EVENT_NAME: "workflow_run",
      SUMMARY_PRESENT: "True",
      OK_FROM_REDEPLOY: "",
      DISPATCH_SERVICE: "",
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(
      /::error::resolve-verify-matrix: workflow_run requires summary_present in \{true,false\}, got 'True'/,
    );
  }, 30_000);

  it("workflow_dispatch + no summary → full probe-eligible set + has_services=true", () => {
    const probe = realProbeEligibleNames();
    const r = runCli({
      EVENT_NAME: "workflow_dispatch",
      SUMMARY_PRESENT: "",
      OK_FROM_REDEPLOY: "",
      DISPATCH_SERVICE: "",
    });
    expect(r.status).toBe(0);
    expect(r.output).toBe(
      `services_csv=${probe.join(",")}\nhas_services=true\n`,
    );
  }, 30_000);

  it("workflow_dispatch + unknown service → non-zero exit with ::error::Unknown service", () => {
    const r = runCli({
      EVENT_NAME: "workflow_dispatch",
      SUMMARY_PRESENT: "",
      OK_FROM_REDEPLOY: "",
      DISPATCH_SERVICE: "totally-not-a-real-service",
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(
      /::error::Unknown service 'totally-not-a-real-service'/,
    );
  }, 30_000);
});
