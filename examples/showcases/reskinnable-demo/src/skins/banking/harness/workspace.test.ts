import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { prepareWorkspace, readSummary } from "./workspace";

describe("prepareWorkspace", () => {
  it("materialises the csv into a fresh scratch dir", async () => {
    const { dir, summaryPath } = await prepareWorkspace("a,b\n1,2\n");
    expect(readFileSync(join(dir, "expenses.csv"), "utf8")).toBe("a,b\n1,2\n");
    expect(summaryPath).toBe(join(dir, "summary.json"));
  });

  it("gives concurrent runs different dirs", async () => {
    const a = await prepareWorkspace("x\n");
    const b = await prepareWorkspace("x\n");
    expect(a.dir).not.toBe(b.dir);
  });
});

describe("readSummary", () => {
  it("reads the harness-written verdict and stamps elapsed time", async () => {
    const { dir, summaryPath } = await prepareWorkspace("x\n");
    await writeFile(
      summaryPath,
      JSON.stringify({
        rowsRead: 2,
        merchantsSearched: 1,
        totalExpensable: 10,
        totalPersonal: 5,
        verdicts: [
          {
            merchant: "Hotel Verrano",
            date: "2026-07-14",
            amount: 10,
            decision: "expensable",
            reason: "lodging during the Austin offsite",
          },
        ],
      }),
      "utf8",
    );

    const summary = await readSummary(summaryPath, 214);
    expect(summary.rowsRead).toBe(2);
    expect(summary.elapsedSeconds).toBe(214);
    expect(summary.verdicts[0].decision).toBe("expensable");
    expect(dir).toContain("harness-");
  });

  it("throws a diagnostic when the harness wrote nothing", async () => {
    const { summaryPath } = await prepareWorkspace("x\n");
    await expect(readSummary(summaryPath, 1)).rejects.toThrow(
      /never wrote summary\.json/,
    );
  });
});
