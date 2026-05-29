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
import { execFileSync } from "node:child_process";
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
const SSOT_PATH = join(REPO_ROOT, "showcase/scripts/railway-envs.generated.json");

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
  try {
    execFileSync("npx", ["tsx", SCRIPT], {
      cwd: REPO_ROOT,
      env: fullEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      status: 0,
      stderr: "",
      output: readFileSync(outputPath, "utf-8"),
    };
  } catch (e) {
    // execFileSync throws on non-zero exit; the thrown error carries
    // `.status` and `.stderr` (Buffer when stdio captures).
    const err = e as {
      status?: number;
      stderr?: Buffer | string;
    };
    return {
      status: typeof err.status === "number" ? err.status : 1,
      stderr:
        typeof err.stderr === "string"
          ? err.stderr
          : err.stderr
            ? err.stderr.toString("utf-8")
            : "",
      output: readFileSync(outputPath, "utf-8"),
    };
  }
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
  it(
    "workflow_run + summary_present + empty ok_services → has_services=false (Issue A end-to-end)",
    () => {
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
    },
    30_000,
  );

  it(
    "workflow_run + summary_present + two real ok_services → sorted CSV + has_services=true",
    () => {
      const probe = realProbeEligibleNames();
      // Pick TWO probe-eligible names. Use a CSV order that is NOT
      // already sorted so the sort-on-intersection assertion is real.
      // probe[0] sorts before probe[1] (alphabetical); feed reversed.
      const picked = [probe[0], probe[1]];
      const reversedCsv = `${picked[1]},${picked[0]}`;
      const sortedCsv = picked.join(",");
      const r = runCli({
        EVENT_NAME: "workflow_run",
        SUMMARY_PRESENT: "true",
        OK_FROM_REDEPLOY: reversedCsv,
        DISPATCH_SERVICE: "",
      });
      expect(r.status).toBe(0);
      expect(r.output).toBe(
        `services_csv=${sortedCsv}\nhas_services=true\n`,
      );
    },
    30_000,
  );

  it(
    "workflow_dispatch + no summary → full probe-eligible set + has_services=true",
    () => {
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
    },
    30_000,
  );

  it(
    "workflow_dispatch + unknown service → non-zero exit with ::error::Unknown service",
    () => {
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
    },
    30_000,
  );
});
