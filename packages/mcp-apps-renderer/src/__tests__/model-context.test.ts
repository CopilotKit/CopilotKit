import { describe, expect, it } from "vitest";
import {
  MCP_APPS_MODEL_CONTEXT_MAX_LENGTH,
  McpModelContextError,
  ɵbuildModelContextEntry,
  ɵmodelContextKey,
  ɵsupportsModelContext,
} from "../model-context";

const provenance = { resourceUri: "ui://trains/stations", serverId: "trains" };

describe("ɵbuildModelContextEntry", () => {
  it("keeps text blocks in order", () => {
    const entry = ɵbuildModelContextEntry(
      {
        content: [
          { type: "text", text: "The user looks at Lyon." },
          { type: "text", text: "Filter: available seats." },
        ],
      },
      provenance,
    );

    expect(JSON.parse(entry!.value)).toEqual({
      text: ["The user looks at Lyon.", "Filter: available seats."],
    });
  });

  it("keeps structured content alone", () => {
    const entry = ɵbuildModelContextEntry(
      { structuredContent: { stationId: "lyon" } },
      provenance,
    );

    expect(JSON.parse(entry!.value)).toEqual({
      structuredContent: { stationId: "lyon" },
    });
  });

  it("keeps both, losing neither the text nor the structured data", () => {
    const entry = ɵbuildModelContextEntry(
      {
        content: [{ type: "text", text: "Lyon" }],
        structuredContent: { stationId: "lyon", filter: "available" },
      },
      provenance,
    );

    expect(JSON.parse(entry!.value)).toEqual({
      text: ["Lyon"],
      structuredContent: { stationId: "lyon", filter: "available" },
    });
  });

  it("serializes equal states identically, whatever the key order", () => {
    const first = ɵbuildModelContextEntry(
      { structuredContent: { b: 1, a: { d: 2, c: 3 } } },
      provenance,
    );
    const second = ɵbuildModelContextEntry(
      { structuredContent: { a: { c: 3, d: 2 }, b: 1 } },
      provenance,
    );

    expect(first!.value).toBe(second!.value);
  });

  it("describes the value as data from the named widget, not instructions", () => {
    const entry = ɵbuildModelContextEntry(
      { content: [{ type: "text", text: "x" }] },
      provenance,
    );

    expect(entry!.description).toContain("ui://trains/stations");
    expect(entry!.description).toContain('"trains"');
    expect(entry!.description).toContain("not instructions");
  });

  it("clears the state for an empty update", () => {
    expect(ɵbuildModelContextEntry({}, provenance)).toBeNull();
    expect(ɵbuildModelContextEntry({ content: [] }, provenance)).toBeNull();
  });

  it("keeps an explicit empty structuredContent as a valid state", () => {
    const entry = ɵbuildModelContextEntry(
      { structuredContent: {} },
      provenance,
    );

    expect(JSON.parse(entry!.value)).toEqual({ structuredContent: {} });
  });

  it("refuses blocks other than text", () => {
    for (const type of ["image", "audio", "resource", "resource_link"]) {
      expect(() =>
        ɵbuildModelContextEntry(
          {
            content: [
              { type: "text", text: "ok" },
              { type } as { type: string },
            ],
          },
          provenance,
        ),
      ).toThrow(McpModelContextError);
    }
  });

  it("refuses a snapshot above the size limit", () => {
    expect(() =>
      ɵbuildModelContextEntry(
        {
          content: [
            {
              type: "text",
              text: "x".repeat(MCP_APPS_MODEL_CONTEXT_MAX_LENGTH),
            },
          ],
        },
        provenance,
      ),
    ).toThrow(/at most/);
  });

  it("refuses a value JSON cannot represent", () => {
    expect(() =>
      ɵbuildModelContextEntry(
        { structuredContent: { count: BigInt(1) } },
        provenance,
      ),
    ).toThrow(McpModelContextError);
  });
});

describe("ɵmodelContextKey", () => {
  const base = {
    agentId: "agent",
    threadId: "thread-a",
    instanceId: "activity-1",
    resourceUri: "ui://trains/stations",
    serverHash: "hash",
    serverId: "trains",
  };

  it("is stable for the same widget instance", () => {
    expect(ɵmodelContextKey(base)).toBe(ɵmodelContextKey({ ...base }));
  });

  it("differs by thread, instance and resource", () => {
    const key = ɵmodelContextKey(base);
    expect(ɵmodelContextKey({ ...base, threadId: "thread-b" })).not.toBe(key);
    expect(ɵmodelContextKey({ ...base, instanceId: "activity-2" })).not.toBe(
      key,
    );
    expect(ɵmodelContextKey({ ...base, resourceUri: "ui://other" })).not.toBe(
      key,
    );
  });
});

describe("ɵsupportsModelContext", () => {
  it("needs both upsertContext and removeContext", () => {
    expect(
      ɵsupportsModelContext({ upsertContext() {}, removeContext() {} }),
    ).toBe(true);
    expect(ɵsupportsModelContext({ upsertContext() {} })).toBe(false);
    expect(ɵsupportsModelContext({ runAgent() {} })).toBe(false);
  });
});
