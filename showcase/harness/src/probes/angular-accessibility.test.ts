import { afterEach, describe, expect, it, vi } from "vitest";

import { angularAxeViolationIdsInBrowser } from "./angular-accessibility";

describe("Angular axe runner", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses axe's one-argument options form and returns sorted violation ids", async () => {
    const run = vi.fn(async () => ({
      violations: [{ id: "label" }, { id: "aria-dialog-name" }],
    }));
    vi.stubGlobal("axe", { run });

    await expect(angularAxeViolationIdsInBrowser()).resolves.toEqual([
      "aria-dialog-name",
      "label",
    ]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]).toHaveLength(1);
    expect(run).toHaveBeenCalledWith({
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
      },
    });
  });
});
