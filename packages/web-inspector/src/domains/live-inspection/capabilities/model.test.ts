import { describe, expect, it } from "vitest";
import { ɵbuildCapabilityRows } from "../../../index.js";
import { buildCapabilityRows } from "./model.js";

describe("buildCapabilityRows", () => {
  it("remains available through the package runtime export", () => {
    expect(ɵbuildCapabilityRows).toBe(buildCapabilityRows);
  });

  it("sorts rows and preserves per-agent enablement calls", () => {
    const calls: Array<[string, string | undefined]> = [];
    const rows = buildCapabilityRows({
      tools: [
        { name: "z-tool", agentId: "agent-2", description: "zed" },
        { name: "a-tool", agentId: "agent-1" },
        { name: "global" },
      ],
      isToolEnabled: (name, agentId) => {
        calls.push([name, agentId]);
        return name === "global";
      },
    });

    expect(rows.map((row) => row.name)).toEqual(["global", "a-tool", "z-tool"]);
    expect(rows[0]).toMatchObject({
      key: ":global",
      agentId: undefined,
      enabled: true,
    });
    expect(calls).toEqual([
      ["z-tool", "agent-2"],
      ["a-tool", "agent-1"],
      ["global", undefined],
    ]);
  });

  it("returns no rows when no tools are registered", () => {
    expect(buildCapabilityRows({ isToolEnabled: () => false })).toEqual([]);
  });
});
