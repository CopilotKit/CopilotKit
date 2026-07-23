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

  it("emits per-env healthcheckPath when the SSOT declares one, omits it for live-null services", () => {
    const services = parsed.services as Array<{
      name: string;
      healthcheckPath?: { prod?: string; staging?: string };
    }>;

    // aimock declares /health in BOTH envs (the repaired incident service).
    const aimock = services.find((s) => s.name === "aimock");
    expect(aimock?.healthcheckPath).toEqual({
      prod: "/health",
      staging: "/health",
    });

    // An agent integration is /api/health in both envs.
    const agent = services.find((s) => s.name === "showcase-ag2");
    expect(agent?.healthcheckPath).toEqual({
      prod: "/api/health",
      staging: "/api/health",
    });

    // shell is the Next.js shell that probes `/` (NOT the live-null docs/dojo).
    const shell = services.find((s) => s.name === "shell");
    expect(shell?.healthcheckPath).toEqual({ prod: "/", staging: "/" });

    // docs is live-null in BOTH envs → the healthcheckPath key is OMITTED
    // entirely (never `/`), so the pin omits the mutation field.
    const docs = services.find((s) => s.name === "docs");
    expect(docs?.healthcheckPath).toBeUndefined();

    // harness-workers is now dual-env: /health in BOTH prod and staging (the
    // prod worker was backfilled into the SSOT, each env declaring the shared
    // showcase-harness probe path).
    const workers = services.find((s) => s.name === "harness-workers");
    expect(workers?.healthcheckPath).toEqual({
      prod: "/health",
      staging: "/health",
    });
    expect(workers?.healthcheckPath?.prod).toBe("/health");
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

describe("emit-railway-envs-json EMIT_SKIP_OXFMT ephemeral opt-out", () => {
  // The promote workflow's resolve-targets / promote jobs regenerate this JSON
  // purely to feed jq / bin/railway in-memory; the output is NEVER committed,
  // and that job's `npm ci` does not install the repo-root oxfmt binary the
  // committed path shells out to. EMIT_SKIP_OXFMT=1 lets those jobs skip the
  // oxfmt-canonical pass so a missing binary no longer ENOENT-aborts EVERY
  // promote. These tests assert the OPT-OUT behavior directly: with
  // EMIT_SKIP_OXFMT=1 the emitter SUCCEEDS without invoking oxfmt and returns
  // the raw JSON.stringify form. (The DEFAULT, oxfmt-required path is covered
  // by the "oxfmt-canonical output" golden tests above; we do not assert a
  // failure here because whether oxfmt is installed varies by checkout, which
  // would make a `skip=false` failure assertion non-deterministic.)
  function emitWithSkip(): {
    status: number | null;
    stderr: string;
    out: string;
    cleanup: () => void;
  } {
    const dir = mkdtempSync(join(tmpdir(), "emit-railway-envs-skip-"));
    const out = join(dir, "railway-envs.generated.json");
    const env = { ...process.env, EMIT_SKIP_OXFMT: "1" };
    const res = spawnSync("npx", ["tsx", EMITTER, `--out=${out}`], {
      cwd: SCRIPTS_DIR,
      stdio: "pipe",
      encoding: "utf8",
      env,
    });
    return {
      status: res.status,
      stderr: res.stderr ?? "",
      out,
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  }

  it("EMIT_SKIP_OXFMT=1 emits valid JSON (no oxfmt invocation required)", () => {
    const r = emitWithSkip();
    try {
      expect(r.status).toBe(0);
      // The emitted artifact parses and carries the shape downstream consumers
      // (jq in resolve-promote-targets.sh) depend on.
      const parsed = JSON.parse(readFileSync(r.out, "utf8")) as {
        services: Array<{ name: string; probe: { prod: boolean } }>;
        closure: { services: unknown[] };
      };
      expect(Array.isArray(parsed.services)).toBe(true);
      expect(parsed.services.length).toBeGreaterThan(0);
      expect(parsed.services.some((s) => s.probe.prod === true)).toBe(true);
      expect(Array.isArray(parsed.closure.services)).toBe(true);
    } finally {
      r.cleanup();
    }
  });

  it("EMIT_SKIP_OXFMT=1 output is the raw JSON.stringify form (skips oxfmt)", () => {
    // The skip path returns `JSON.stringify(_, null, 2)` verbatim: multi-line
    // arrays (oxfmt would collapse short arrays onto one line). We assert at
    // least one multi-line array marker exists, proving oxfmt was NOT run — the
    // exact divergence the committed path canonicalizes away.
    const r = emitWithSkip();
    try {
      expect(r.status).toBe(0);
      const raw = readFileSync(r.out, "utf8");
      // A raw JSON.stringify(_, null, 2) renders nested array elements on their
      // own indented lines; oxfmt-canonical collapses short ones. The presence
      // of a newline immediately inside an array bracket evidences the raw form.
      expect(raw).toMatch(/\[\n\s+"/);
    } finally {
      r.cleanup();
    }
  });
});
