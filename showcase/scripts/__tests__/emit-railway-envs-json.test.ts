import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = resolve(__dirname, "..", "emit-railway-envs-json.ts");
const OUTPUT = resolve(__dirname, "..", "railway-envs.generated.json");

describe("emit-railway-envs-json", () => {
  it("emits canonical JSON containing every SSOT service", () => {
    execFileSync("npx", ["tsx", SCRIPT], { stdio: "pipe" });
    const json = JSON.parse(readFileSync(OUTPUT, "utf8"));
    expect(json.projectId).toBe("6f8c6bff-a80d-4f8f-b78d-50b32bcf4479");
    expect(json.envIds.staging).toBe("8edfef02-ea09-4a20-8689-261f21cc2849");
    expect(json.envIds.prod).toBe("b14919f4-6417-429f-848d-c6ae2201e04f");
    expect(json.services.length).toBe(27);
    const docs = json.services.find(
      (s: { name: string }) => s.name === "docs",
    );
    expect(docs.domains.staging).toBe("docs.staging.copilotkit.ai");
    expect(docs.domains.prod).toBe("docs.copilotkit.ai");
    expect(docs.probe.driver).toBe("docs");
  });

  it("--check passes when on-disk JSON matches SSOT", () => {
    execFileSync("npx", ["tsx", SCRIPT], { stdio: "pipe" });
    const out = execFileSync("npx", ["tsx", SCRIPT, "--check"], {
      stdio: "pipe",
    }).toString();
    expect(out).toMatch(/up to date/);
  });

  it("--check FAILS when on-disk JSON is stale", () => {
    execFileSync("npx", ["tsx", SCRIPT], { stdio: "pipe" });
    const original = readFileSync(OUTPUT, "utf8");
    try {
      writeFileSync(OUTPUT, original.replace(/docs.copilotkit.ai/g, "x"));
      expect(() =>
        execFileSync("npx", ["tsx", SCRIPT, "--check"], {
          stdio: "pipe",
        }),
      ).toThrow();
    } finally {
      writeFileSync(OUTPUT, original);
    }
  });
});
