import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SERVICES, computePromoteClosure } from "./railway-envs";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const EMITTER = resolve(SCRIPTS_DIR, "emit-railway-envs-json.ts");
const OXFMT = resolve(SCRIPTS_DIR, "..", "..", "node_modules", ".bin", "oxfmt");

/**
 * Emit the JSON to a hermetic temp path and parse it. The emitter is the
 * single source of the artifact shape, so the test drives the real emitter
 * (via `--out=`) rather than reconstructing the payload.
 */
function emitToTemp(): {
  parsed: Record<string, unknown>;
  raw: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "emit-railway-envs-"));
  const out = join(dir, "railway-envs.generated.json");
  execFileSync("npx", ["tsx", EMITTER, `--out=${out}`], {
    cwd: SCRIPTS_DIR,
    stdio: "pipe",
  });
  const raw = readFileSync(out, "utf8");
  return {
    parsed: JSON.parse(raw) as Record<string, unknown>,
    raw,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe("emit-railway-envs-json closure block", () => {
  let parsed: Record<string, unknown>;
  let cleanup: () => void;

  beforeAll(() => {
    const r = emitToTemp();
    parsed = r.parsed;
    cleanup = r.cleanup;
  });

  afterAll(() => cleanup?.());

  it("emits a top-level `closure` block matching computePromoteClosure(all)", () => {
    const expected = computePromoteClosure(Object.keys(SERVICES));
    expect(parsed.closure).toBeDefined();
    const closure = parsed.closure as {
      services: { name: string; tier: number }[];
      skipped: { name: string; reason: string }[];
    };
    expect(closure.services).toEqual(expected.services);
    expect(closure.skipped).toEqual(expected.skipped);
  });

  it("closure.services is tier-ordered (0 → 1 → 2, non-decreasing)", () => {
    const closure = parsed.closure as {
      services: { name: string; tier: number }[];
    };
    const tiers = closure.services.map((s) => s.tier);
    const sorted = [...tiers].sort((a, b) => a - b);
    expect(tiers).toEqual(sorted);
  });

  it("emits per-service promoteTier / runtimeDeps / serviceRefs from the SSOT", () => {
    const services = parsed.services as Array<{
      name: string;
      promoteTier: number;
      runtimeDeps?: string[];
      serviceRefs?: { key: string; target: string }[];
    }>;

    // aimock is declared tier 0 in the SSOT.
    const aimock = services.find((s) => s.name === "aimock");
    expect(aimock?.promoteTier).toBe(0);

    // An agent integration carries runtimeDeps:["aimock"] + an OPENAI_BASE_URL
    // serviceRef → aimock. Names are SSOT keys (e.g. "showcase-ag2"), not
    // dispatch_names.
    const agent = services.find((s) => s.name === "showcase-ag2");
    expect(agent?.runtimeDeps).toEqual(["aimock"]);
    expect(agent?.serviceRefs).toEqual([
      { key: "OPENAI_BASE_URL", target: "aimock" },
    ]);

    // promoteTier is always present (defaults to 2 for a leaf integration).
    expect(agent?.promoteTier).toBe(2);
  });
});

describe("emit-railway-envs-json legacy shape preservation (golden)", () => {
  it("keeps the committed per-service legacy keys BYTE-IDENTICAL", () => {
    const { parsed, cleanup } = emitToTemp();
    try {
      const committed = JSON.parse(
        readFileSync(
          resolve(SCRIPTS_DIR, "railway-envs.generated.json"),
          "utf8",
        ),
      ) as { services: Array<Record<string, unknown>> };
      const emitted = parsed as unknown as {
        services: Array<Record<string, unknown>>;
      };

      // The set of frozen legacy keys must be a SUBSET of every emitted
      // service, with byte-identical values — new keys (promoteTier/
      // runtimeDeps/serviceRefs) are additive only.
      const LEGACY_KEYS = [
        "name",
        "serviceId",
        "prodInstanceId",
        "stagingInstanceId",
        "ciBuilt",
        "gateValidated",
        "dispatchName",
        "repoNameOverride",
        "domains",
        "probe",
      ];
      const projectLegacy = (s: Record<string, unknown>) => {
        const out: Record<string, unknown> = {};
        for (const k of LEGACY_KEYS) {
          if (Object.hasOwn(s, k)) out[k] = s[k];
        }
        return out;
      };

      const byNameCommitted = new Map(
        committed.services.map((s) => [s.name as string, projectLegacy(s)]),
      );
      for (const s of emitted.services) {
        const legacy = projectLegacy(s);
        expect(byNameCommitted.get(s.name as string)).toEqual(legacy);
      }
    } finally {
      cleanup();
    }
  });

  it("the committed railway-envs.generated.json is up to date (emit --check passes)", () => {
    // GREEN gate: after regen, the in-repo artifact equals the emitter output.
    execFileSync("npx", ["tsx", EMITTER, "--check"], {
      cwd: SCRIPTS_DIR,
      stdio: "pipe",
    });
  });
});

describe("emit-railway-envs-json oxfmt-canonical output", () => {
  // CI's static_quality.yml formats this artifact with oxfmt and auto-commits
  // any drift. If the emitter produced raw `JSON.stringify(_, null, 2)` (with
  // multi-line arrays), `oxfmt --check` would fail forever (oxfmt wants
  // compact arrays) while `emit --check` (a raw string compare) would fail the
  // moment we oxfmt-fixed the file — the two checks conflict. The emitter
  // routes its output through oxfmt so both pass simultaneously, with no bot.
  it("emitter output passes oxfmt --check (no auto-format drift)", () => {
    const dir = mkdtempSync(join(tmpdir(), "emit-railway-envs-oxfmt-"));
    const out = join(dir, "railway-envs.generated.json");
    try {
      // Emit via the real emitter into a hermetic path...
      execFileSync("npx", ["tsx", EMITTER, `--out=${out}`], {
        cwd: SCRIPTS_DIR,
        stdio: "pipe",
      });
      // ...then assert oxfmt considers the result already-canonical. RED on
      // the pre-fix emitter (multi-line arrays → "Format issues found"),
      // GREEN once the emitter routes output through oxfmt.
      const res = spawnSync(OXFMT, ["--check", out], { encoding: "utf8" });
      expect(res.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the committed railway-envs.generated.json passes oxfmt --check", () => {
    // The in-repo artifact must stay oxfmt-canonical so the CI auto-format
    // bot never fires on it.
    const committed = resolve(SCRIPTS_DIR, "railway-envs.generated.json");
    const res = spawnSync(OXFMT, ["--check", committed], { encoding: "utf8" });
    expect(res.status).toBe(0);
  });
});
