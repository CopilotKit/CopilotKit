import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localBackendsEnv } from "./local-backends-env";

describe("localBackendsEnv (next.config build-time helper)", () => {
  let dir: string;
  let portsPath: string;
  let warns: string[];
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "local-backends-env-"));
    portsPath = path.join(dir, "local-ports.json");
    vi.stubEnv("SHOWCASE_LOCAL", "1");
    warns = [];
    warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation((m: string) => void warns.push(m));
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.unstubAllEnvs();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns '' silently (file untouched) when SHOWCASE_LOCAL is explicitly blank", () => {
    // Blank is a deliberate "off" state and stays SILENT — a non-blank
    // value other than "1" warns instead (see the dedicated test
    // below), so the old "is not 1" title misdescribed what this
    // covers. No missing-file warn = the ports file was never read.
    vi.stubEnv("SHOWCASE_LOCAL", "");
    expect(localBackendsEnv(portsPath)).toBe("");
    expect(warns).toEqual([]);
  });

  it("stays silent for unset AND blank/whitespace-only SHOWCASE_LOCAL (both mean off)", () => {
    // Unset (never exported) and blank (`SHOWCASE_LOCAL= npm run build`
    // to explicitly disable) are both deliberate "off" states — neither
    // reads the ports file or logs anything.
    for (const off of [undefined, "", "  \t"]) {
      warns.length = 0;
      vi.stubEnv("SHOWCASE_LOCAL", off);
      expect(
        localBackendsEnv(portsPath),
        `SHOWCASE_LOCAL=${JSON.stringify(off)} should be silent off`,
      ).toBe("");
      expect(warns).toEqual([]);
    }
  });

  it("warns (naming the value) when SHOWCASE_LOCAL is set to something other than '1'", () => {
    // A developer exporting SHOWCASE_LOCAL=true (or =yes, or =0)
    // believes they toggled local backends — the strict "1" contract
    // made that a silent no-op ("why are my local backends not
    // wired?" with zero signal). Set-but-not-"1" must warn; the value
    // is still treated as off.
    for (const bad of ["true", "yes", "0"]) {
      warns.length = 0;
      vi.stubEnv("SHOWCASE_LOCAL", bad);
      expect(localBackendsEnv(portsPath)).toBe("");
      expect(
        warns.some(
          (m) =>
            m.includes("SHOWCASE_LOCAL") && m.includes(JSON.stringify(bad)),
        ),
        `SHOWCASE_LOCAL=${JSON.stringify(bad)} should warn naming the value`,
      ).toBe(true);
    }
  });

  it("treats a whitespace-padded '1' as enabled (paste-artifact tolerance)", () => {
    // Same whitespace tolerance runtime-config.ts applies to every env
    // value (readEnvPair trims) — `SHOWCASE_LOCAL=" 1"` previously
    // failed the strict !== "1" gate and silently disabled local
    // backends.
    vi.stubEnv("SHOWCASE_LOCAL", " 1\t");
    fs.writeFileSync(portsPath, JSON.stringify({ mastra: 3104 }));
    expect(JSON.parse(localBackendsEnv(portsPath))).toEqual({
      mastra: "http://localhost:3104",
    });
    expect(warns).toEqual([]);
  });

  it("maps slugs to localhost URLs for valid integer ports", () => {
    fs.writeFileSync(portsPath, JSON.stringify({ mastra: 3104, agno: 3109 }));
    expect(JSON.parse(localBackendsEnv(portsPath))).toEqual({
      mastra: "http://localhost:3104",
      agno: "http://localhost:3109",
    });
    expect(warns).toEqual([]);
  });

  it("warns loudly (naming the path) when SHOWCASE_LOCAL=1 but the file is missing", () => {
    // The developer explicitly opted in — a silent '' here means "why
    // are my local backends not wired?" with zero signal, while corrupt
    // JSON in the same file THROWS. Missing must be loud too.
    expect(localBackendsEnv(portsPath)).toBe("");
    expect(warns.some((m) => m.includes(portsPath))).toBe(true);
  });

  it("THROWS (naming the slug) on non-integer and out-of-range ports (3.5 / 0 / -1 / 99999)", () => {
    // This runs at BUILD time — the file's stated fail-loud posture is
    // that throwing IS the loud path. A warn+skip silently shipped a
    // build with that integration's override missing.
    for (const [slug, port] of [
      ["frac", 3.5],
      ["zero", 0],
      ["neg", -1],
      ["huge", 99999],
    ] as const) {
      fs.writeFileSync(portsPath, JSON.stringify({ [slug]: port, ok: 3104 }));
      expect(
        () => localBackendsEnv(portsPath),
        `port ${port} for "${slug}" should throw`,
      ).toThrow(new RegExp(`"${slug}"`));
    }
    // Boundary values stay valid.
    fs.writeFileSync(portsPath, JSON.stringify({ ok: 65535, low: 1 }));
    expect(JSON.parse(localBackendsEnv(portsPath))).toEqual({
      ok: "http://localhost:65535",
      low: "http://localhost:1",
    });
  });

  it("THROWS (naming the slug) on non-number port values", () => {
    fs.writeFileSync(portsPath, JSON.stringify({ str: "3104", ok: 3104 }));
    expect(() => localBackendsEnv(portsPath)).toThrow(/"str"/);
  });

  it("throws (naming the path) on corrupt JSON", () => {
    fs.writeFileSync(portsPath, "{not json");
    expect(() => localBackendsEnv(portsPath)).toThrow(portsPath);
  });

  // chmod-based denial tests are meaningless as root (root bypasses
  // permission bits, so the read SUCCEEDS and the assertions fail for
  // a reason unrelated to the code under test) — skip them there.
  const runningAsRoot = process.getuid?.() === 0;

  it.skipIf(runningAsRoot)(
    "labels an unreadable file as a read failure, not as invalid JSON",
    () => {
      // fs.readFileSync used to live INSIDE the JSON.parse try — an
      // EACCES surfaced as "<path> is not valid JSON", sending the
      // developer to inspect a file's syntax when the problem is its
      // permissions.
      fs.writeFileSync(portsPath, "{}");
      fs.chmodSync(portsPath, 0o000);
      try {
        let thrown: unknown;
        try {
          localBackendsEnv(portsPath);
        } catch (err) {
          thrown = err;
        }
        expect(thrown).toBeInstanceOf(Error);
        const message = (thrown as Error).message;
        expect(message).toContain(portsPath);
        expect(message).toContain("could not be read");
        expect(message).not.toContain("not valid JSON");
      } finally {
        fs.chmodSync(portsPath, 0o600);
      }
    },
  );

  it.skipIf(runningAsRoot)(
    "labels an unsearchable parent directory as a read failure, not as a missing file",
    () => {
      // fs.existsSync returns false for EACCES on the parent directory —
      // the old guard masked a permissions problem as "file does not
      // exist", defeating the labeled-throw design the read/parse split
      // exists for. The direct-read ENOENT branch keeps missing-file
      // semantics while every OTHER read error throws with its real cause.
      fs.writeFileSync(portsPath, "{}");
      fs.chmodSync(dir, 0o000);
      try {
        let thrown: unknown;
        try {
          localBackendsEnv(portsPath);
        } catch (err) {
          thrown = err;
        }
        expect(thrown).toBeInstanceOf(Error);
        const message = (thrown as Error).message;
        expect(message).toContain(portsPath);
        expect(message).toContain("could not be read");
        // It must NOT have taken the missing-file warn path.
        expect(warns.some((m) => m.includes("does not exist"))).toBe(false);
      } finally {
        fs.chmodSync(dir, 0o700);
      }
    },
  );

  it("warns (naming the key) on slugs that violate the [a-z0-9-]+ contract", () => {
    // Registry slugs are [a-z0-9-]+ (see backend-url.ts SLUG_RE) — a
    // key like "Mastra" can never match an integration slug, so its
    // override is a silent no-op at runtime. Warn at build time.
    fs.writeFileSync(
      portsPath,
      JSON.stringify({ Mastra: 3104, under_score: 3105, ok: 3106 }),
    );
    const out = JSON.parse(localBackendsEnv(portsPath)) as Record<
      string,
      string
    >;
    // Pin the include-vs-skip behavior: warn-only entries are still
    // EMITTED (the warn says "can never apply", not "dropped") — a
    // silent skip here would contradict the warn text.
    expect(out).toEqual({
      Mastra: "http://localhost:3104",
      under_score: "http://localhost:3105",
      ok: "http://localhost:3106",
    });
    expect(warns.some((m) => m.includes('"Mastra"'))).toBe(true);
    expect(warns.some((m) => m.includes('"under_score"'))).toBe(true);
    // A contract-conforming map stays silent.
    warns.length = 0;
    fs.writeFileSync(portsPath, JSON.stringify({ "langgraph-python": 3104 }));
    localBackendsEnv(portsPath);
    expect(warns).toEqual([]);
  });

  it("emits a __proto__ key as map data instead of silently dropping it", () => {
    // The accumulator was a plain `{}` — `map["__proto__"] = ...` hits
    // the Object.prototype setter and is a silent no-op, so the entry
    // vanished from the emitted JSON even though the slug-contract warn
    // fired. A null-prototype accumulator makes it an ordinary own
    // property (and the [a-z0-9-]+ warn still flags it).
    fs.writeFileSync(portsPath, '{"__proto__": 3104, "ok": 3105}');
    const out = JSON.parse(localBackendsEnv(portsPath)) as Record<
      string,
      string
    >;
    expect(Object.keys(out)).toContain("__proto__");
    expect(out["__proto__"]).toBe("http://localhost:3104");
    expect(out.ok).toBe("http://localhost:3105");
    expect(warns.some((m) => m.includes('"__proto__"'))).toBe(true);
  });

  it("warns loudly when SHOWCASE_LOCAL=1 in a production build (localhost targets in a prod image)", () => {
    // `next build` runs with NODE_ENV=production — refusing outright
    // would break the documented local production-build flow, but a
    // silent pass bakes localhost iframe targets into an image that
    // must never deploy. Loud warn.
    vi.stubEnv("NODE_ENV", "production");
    fs.writeFileSync(portsPath, JSON.stringify({ mastra: 3104 }));
    expect(JSON.parse(localBackendsEnv(portsPath))).toEqual({
      mastra: "http://localhost:3104",
    });
    expect(
      warns.some(
        (m) => m.includes("SHOWCASE_LOCAL") && m.includes("production"),
      ),
    ).toBe(true);
  });

  it("throws (naming the path) on a non-object top level", () => {
    fs.writeFileSync(portsPath, "[1,2]");
    expect(() => localBackendsEnv(portsPath)).toThrow(portsPath);
  });
});
