import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const root = mkdtempSync(join(tmpdir(), "genui-eval-e2e-"));
let main: (argv: string[]) => Promise<void>;

beforeAll(async () => {
  process.env.GENUI_EVAL_RESULTS = root;
  delete process.env.OPENROUTER_API_KEY;
  ({ main } = await import("../src/cli"));
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.GENUI_EVAL_RESULTS;
});

/** Runs a CLI command and returns its stdout, parsed when it is JSON. */
async function cli(...argv: string[]) {
  let out = "";
  const write = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      out += String(chunk);
      return true;
    });
  const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    await main(argv);
  } finally {
    write.mockRestore();
    err.mockRestore();
  }
  try {
    return JSON.parse(out);
  } catch {
    return out;
  }
}

describe("the CLI, offline with no key", () => {
  it("runs, reports, lists failures, prints prompts, labels, calibrates and optimizes", async () => {
    const report = await cli(
      "run",
      "--preset",
      "offline",
      "--cases",
      "tag:smoke",
      "--json",
    );
    expect(report.models[0].model).toBe("fake");
    expect(report.totals.samples).toBeGreaterThan(0);

    const again = await cli("report", "latest", "--json");
    expect(again.run.id).toBe(report.run.id);

    const rows = await cli(
      "failures",
      "latest",
      "--tier",
      "judgement",
      "--json",
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r: { case: string }) => r.case !== "hiking-map")).toBe(
      true,
    );

    const prompts = await cli("prompt", "--transport", "tool", "--json");
    expect(prompts.tool).toContain("## Generative UI");

    const labelled = await cli("label", "latest", "--n", "3", "--json");
    const lines = readFileSync(labelled.file, "utf8")
      .trim()
      .split("\n")
      .map((l: string) => JSON.parse(l));
    for (const row of lines) row.human = { judgement: 1, quality: 1 };
    writeFileSync(
      labelled.file,
      lines.map((l: unknown) => JSON.stringify(l)).join("\n"),
    );
    const calibration = await cli("calibrate", labelled.file, "--json");
    expect(calibration.judgement.labelled).toBe(lines.length);
    rmSync(labelled.file);

    const optimized = await cli(
      "optimize",
      "--preset",
      "offline",
      "--cases",
      "tag:smoke",
      "--transports",
      "markdown",
      "--rounds",
      "1",
      "--batch",
      "3",
      "--json",
    );
    expect(optimized.leaderboard.length).toBeGreaterThanOrEqual(1);
    expect(optimized.outDir).toContain(root);
  });

  it("refuses a real model without a key before any call", async () => {
    await expect(
      cli("run", "--preset", "smoke", "--split", "train"),
    ).rejects.toThrow("OPENROUTER_API_KEY is not set");
  });
});
