import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnyTool } from "@tanstack/ai";
import { mergeMCPTools, resolveMCPToolNames } from "../mcp-tool-names";

/** One tool per entry, named by the key and described by the value. */
const tools = (descriptionsByName: Record<string, string>): AnyTool[] =>
  Object.entries(descriptionsByName).map(([name, description]) => ({
    name,
    description,
  }));

const descriptions = (merged: readonly AnyTool[]) =>
  Object.fromEntries(merged.map((t) => [t.name, t.description]));

describe("resolveMCPToolNames", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps both tools when two servers share a name", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const merged = mergeMCPTools(
      [],
      [
        { label: "prod", tools: tools({ search: "first" }) },
        { label: "prod", tools: tools({ search: "second" }) },
      ],
    );

    expect(descriptions(merged)).toEqual({
      prod_search: "first",
      prod_search_2: "second",
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'More than one MCP server uses the prefix "prod"',
      ),
    );
  });

  it("keeps both tools when two names reduce to the same prefix", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const merged = mergeMCPTools(
      [],
      [
        { label: "a_b", tools: tools({ lookup: "first" }) },
        { label: "a_b", tools: tools({ lookup: "second" }) },
      ],
    );

    expect(merged.map((t) => t.name).sort()).toEqual([
      "a_b_lookup",
      "a_b_lookup_2",
    ]);
  });

  it("does not warn about a shared prefix when no tool needed a number", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    mergeMCPTools(
      [],
      [
        { label: "quiet", tools: tools({ quiet_a: "a" }) },
        { label: "quiet", tools: tools({ quiet_b: "b" }) },
      ],
    );

    expect(warn).not.toHaveBeenCalled();
  });

  it("does not let a prefixed name replace another server's tool", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const merged = mergeMCPTools(
      [],
      [
        { label: "mcp1", tools: tools({ search: "server 1 search" }) },
        {
          label: "mcp2",
          tools: tools({
            search: "server 2 search",
            mcp1_search: "server 2 mcp1_search",
          }),
        },
      ],
    );

    expect(descriptions(merged)).toEqual({
      // A name that collides with nothing keeps it.
      mcp1_search: "server 2 mcp1_search",
      mcp1_search_2: "server 1 search",
      mcp2_search: "server 2 search",
    });
  });

  it("does not let a prefixed name replace an app tool", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const merged = mergeMCPTools(
      tools({ search: "app search", mcp1_search: "app mcp1_search" }),
      [{ label: "mcp1", tools: tools({ search: "mcp search" }) }],
    );

    expect(descriptions(merged)).toEqual({
      search: "app search",
      mcp1_search: "app mcp1_search",
      mcp1_search_2: "mcp search",
    });
  });

  it("exposes a renamed MCP tool as a copy that still executes", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mcpSearch: AnyTool = {
      name: "search",
      description: "mcp search",
      execute: async ({ query }: { query: string }) => `mcp:${query}`,
    };

    const merged = mergeMCPTools(tools({ search: "app search" }), [
      { label: "mcp1", tools: [mcpSearch] },
    ]);
    const renamed = merged.find((t) => t.name === "mcp1_search");

    expect(await renamed?.execute?.({ query: "docs" })).toBe("mcp:docs");
    expect(mcpSearch.name).toBe("search");
  });

  it("tells mcpClients users that their prefix is positional", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    resolveMCPToolNames(new Set(), [
      { label: "mcp1", names: ["hint_probe"] },
      { label: "mcp2", names: ["hint_probe"] },
    ]);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("`mcpClients` entries always use `mcp<N>`"),
    );
  });

  it("forgets old warnings instead of keeping every one for the life of the process", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const collide = (name: string) =>
      resolveMCPToolNames(new Set(), [
        { label: "mcp1", names: [name] },
        { label: "mcp2", names: [name] },
      ]);

    collide("first_name");
    for (let i = 0; i < 1000; i++) collide(`filler_${i}`);
    warn.mockClear();
    collide("first_name");

    expect(warn).toHaveBeenCalledTimes(1);
  });
});
