import { describe, it, expect } from "vitest";
import {
  isoWeekNumber,
  loadReferenceSnapshot,
  resolveD6Mode,
  selectD6Targets,
  selectOnDemandTarget,
  selectWeeklyRotationTarget,
} from "./d6-scoping.js";
import type { ParitySnapshot } from "./parity-compare.js";

describe("d6-scoping — resolveD6Mode", () => {
  it("defaults to weekly-rotation when D6_MODE is absent", () => {
    expect(resolveD6Mode({})).toBe("weekly-rotation");
  });

  it("defaults to weekly-rotation when D6_MODE is empty string", () => {
    expect(resolveD6Mode({ D6_MODE: "" })).toBe("weekly-rotation");
  });

  it("returns the literal mode when valid", () => {
    expect(resolveD6Mode({ D6_MODE: "on-demand" })).toBe("on-demand");
    expect(resolveD6Mode({ D6_MODE: "weekly-rotation" })).toBe(
      "weekly-rotation",
    );
  });

  it("throws on a misspelled mode", () => {
    expect(() => resolveD6Mode({ D6_MODE: "weekly_rotation" })).toThrow(
      /D6_MODE must be/,
    );
  });
});

describe("d6-scoping — isoWeekNumber", () => {
  it("returns 1 for early January in years where week 1 starts in Jan", () => {
    // 2024-01-04 is a Thursday — guaranteed in week 1 by ISO definition.
    expect(isoWeekNumber(new Date("2024-01-04T00:00:00Z"))).toBe(1);
  });

  it("returns the right week for a known mid-year date", () => {
    // 2026-04-25 (date in CLAUDE.md context) is a Saturday in week 17.
    expect(isoWeekNumber(new Date("2026-04-25T00:00:00Z"))).toBe(17);
  });
});

describe("d6-scoping — selectWeeklyRotationTarget", () => {
  it("returns empty selection when no integrations are wired", () => {
    const result = selectWeeklyRotationTarget(
      [],
      new Date("2026-04-25T00:00:00Z"),
    );
    expect(result.mode).toBe("weekly-rotation");
    expect(result.selected).toEqual([]);
    expect(result.reason).toMatch(/no integrations/);
  });

  it("rotates deterministically across weeks given a fixed integration list", () => {
    const integrations = ["a", "b", "c", "d", "e"];
    // Pick a Monday (week boundary) and walk forward 5 weeks; each
    // week should pick a different index in the sorted list (with
    // wraparound after a full cycle).
    const weeks = [
      new Date("2026-01-05T04:00:00Z"), // ISO week 2
      new Date("2026-01-12T04:00:00Z"), // ISO week 3
      new Date("2026-01-19T04:00:00Z"), // ISO week 4
      new Date("2026-01-26T04:00:00Z"), // ISO week 5
      new Date("2026-02-02T04:00:00Z"), // ISO week 6
    ];
    const picks = weeks.map(
      (d) => selectWeeklyRotationTarget(integrations, d).selected[0]!,
    );
    // 5 distinct integrations × 5 consecutive weeks → all 5 covered.
    expect(new Set(picks).size).toBe(5);
  });

  it("sorts integrations defensively so input order doesn't shift the rotation", () => {
    const date = new Date("2026-04-25T00:00:00Z");
    const a = selectWeeklyRotationTarget(["c", "a", "b"], date);
    const b = selectWeeklyRotationTarget(["a", "b", "c"], date);
    expect(a.selected).toEqual(b.selected);
  });

  it("week 17 mod 5 = 2 → picks the third sorted slug", () => {
    const result = selectWeeklyRotationTarget(
      ["a", "b", "c", "d", "e"],
      new Date("2026-04-25T00:00:00Z"),
    );
    expect(result.selected).toEqual(["c"]);
    expect(result.reason).toMatch(/week 17/);
  });
});

describe("d6-scoping — selectOnDemandTarget", () => {
  it("returns the env target", () => {
    const result = selectOnDemandTarget({
      D6_MODE: "on-demand",
      D6_TARGET_INTEGRATION: "langgraph-python",
    });
    expect(result.mode).toBe("on-demand");
    expect(result.selected).toEqual(["langgraph-python"]);
  });

  it("throws when D6_TARGET_INTEGRATION is absent", () => {
    expect(() => selectOnDemandTarget({ D6_MODE: "on-demand" })).toThrow(
      /D6_TARGET_INTEGRATION/,
    );
  });

  it("throws when D6_TARGET_INTEGRATION is empty", () => {
    expect(() =>
      selectOnDemandTarget({ D6_MODE: "on-demand", D6_TARGET_INTEGRATION: "" }),
    ).toThrow(/D6_TARGET_INTEGRATION/);
  });
});

describe("d6-scoping — selectD6Targets dispatcher", () => {
  it("dispatches to weekly-rotation by default", () => {
    const result = selectD6Targets(
      {},
      ["a", "b", "c"],
      new Date("2026-04-25T00:00:00Z"),
    );
    expect(result.mode).toBe("weekly-rotation");
    expect(result.selected.length).toBe(1);
  });

  it("dispatches to on-demand when env says so", () => {
    const result = selectD6Targets(
      { D6_MODE: "on-demand", D6_TARGET_INTEGRATION: "mastra" },
      ["a", "b", "c"],
      new Date("2026-04-25T00:00:00Z"),
    );
    expect(result.mode).toBe("on-demand");
    expect(result.selected).toEqual(["mastra"]);
  });
});

describe("d6-scoping — loadReferenceSnapshot", () => {
  const validSnapshot: ParitySnapshot = {
    domElements: [{ tag: "div", classes: ["copilotkit-chat"] }],
    toolCalls: ["weather"],
    streamProfile: { ttft_ms: 100, p50_chunk_ms: 50, total_chunks: 5 },
    contractShape: { "messages[].role": "string" },
  };

  it("returns ok with the parsed snapshot when file exists and shape is valid", async () => {
    const result = await loadReferenceSnapshot(
      "agentic-chat",
      "/fake/dir",
      async (filePath) => {
        expect(filePath).toBe("/fake/dir/agentic-chat.json");
        return JSON.stringify(validSnapshot);
      },
    );
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.snapshot.toolCalls).toEqual(["weather"]);
      expect(result.snapshotPath).toBe("/fake/dir/agentic-chat.json");
    }
  });

  it("returns missing when the file does not exist (ENOENT)", async () => {
    const result = await loadReferenceSnapshot(
      "tool-rendering",
      "/fake/dir",
      async () => {
        const err = new Error("ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      },
    );
    expect(result.status).toBe("missing");
    if (result.status === "missing") {
      expect(result.reason).toMatch(/no reference snapshot/);
    }
  });

  it("returns invalid when JSON.parse fails", async () => {
    const result = await loadReferenceSnapshot(
      "agentic-chat",
      "/fake/dir",
      async () => "this is not json {{{",
    );
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.reason).toMatch(/JSON parse/);
    }
  });

  it("returns invalid when the parsed value is not a ParitySnapshot", async () => {
    const result = await loadReferenceSnapshot(
      "agentic-chat",
      "/fake/dir",
      async () => JSON.stringify({ wrong: "shape" }),
    );
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.reason).toMatch(/shape mismatch/);
    }
  });

  it("returns invalid on non-ENOENT read errors", async () => {
    const result = await loadReferenceSnapshot(
      "agentic-chat",
      "/fake/dir",
      async () => {
        const err = new Error("EACCES") as NodeJS.ErrnoException;
        err.code = "EACCES";
        throw err;
      },
    );
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.reason).toMatch(/read failed/);
    }
  });
});
