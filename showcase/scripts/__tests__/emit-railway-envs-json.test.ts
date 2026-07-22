import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = resolve(__dirname, "..", "emit-railway-envs-json.ts");

describe("emit-railway-envs-json", () => {
  let workDir: string;
  let outPath: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "emit-railway-envs-"));
    outPath = join(workDir, "railway-envs.generated.json");
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("emits canonical JSON containing every SSOT service", () => {
    execFileSync("npx", ["tsx", SCRIPT, `--out=${outPath}`], { stdio: "pipe" });
    const json = JSON.parse(readFileSync(outPath, "utf8"));
    expect(json.projectId).toBe("6f8c6bff-a80d-4f8f-b78d-50b32bcf4479");
    expect(json.envIds.staging).toBe("8edfef02-ea09-4a20-8689-261f21cc2849");
    expect(json.envIds.prod).toBe("b14919f4-6417-429f-848d-c6ae2201e04f");
    expect(json.services.length).toBe(42);
    const docs = json.services.find((s: { name: string }) => s.name === "docs");
    expect(docs.domains.staging).toBe("docs.staging.copilotkit.ai");
    expect(docs.domains.prod).toBe("docs.copilotkit.ai");
    expect(docs.probe.driver).toBe("docs");
  });

  it("--check passes when on-disk JSON matches SSOT", () => {
    execFileSync("npx", ["tsx", SCRIPT, `--out=${outPath}`], { stdio: "pipe" });
    const out = execFileSync(
      "npx",
      ["tsx", SCRIPT, "--check", `--out=${outPath}`],
      { stdio: "pipe" },
    ).toString();
    expect(out).toMatch(/up to date/);
  });

  it("--check FAILS with a staleness diagnostic when on-disk JSON is stale", () => {
    execFileSync("npx", ["tsx", SCRIPT, `--out=${outPath}`], { stdio: "pipe" });
    const original = readFileSync(outPath, "utf8");
    writeFileSync(outPath, original.replace(/docs.copilotkit.ai/g, "x"));
    const result = spawnSync(
      "npx",
      ["tsx", SCRIPT, "--check", `--out=${outPath}`],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/stale/);
  });

  it("--check FAILS LOUD on non-ENOENT read errors (e.g. EISDIR)", () => {
    // Point --out at a directory so readFileSync raises EISDIR (not ENOENT).
    // The script must NOT silently treat this as drift; it must exit non-zero
    // with a real error written to stderr, distinct from the staleness exit
    // (we use exit code 2 vs 1 to make the distinction observable).
    const subdir = mkdtempSync(join(workDir, "isdir-"));
    const result = spawnSync(
      "npx",
      ["tsx", SCRIPT, "--check", `--out=${subdir}`],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/EISDIR|illegal operation on a directory/i);
    // Must NOT be the staleness message
    expect(result.stderr).not.toMatch(/is stale/);
  });
});
