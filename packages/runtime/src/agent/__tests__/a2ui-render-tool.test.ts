import { describe, it, expect } from "vitest";
import type { RunAgentInput } from "@ag-ui/client";
import type { ToolSet } from "ai";
import {
  A2UI_OPERATIONS_KEY,
  a2uiRenderToolNames,
  buildA2uiOperationsFromRenderArgs,
  catalogIdFromA2UIContext,
  withA2UIRenderToolExecutors,
} from "../a2ui-render-tool";

function input(overrides?: Partial<RunAgentInput>): RunAgentInput {
  return {
    threadId: "t",
    runId: "r",
    messages: [],
    tools: [],
    context: [],
    state: {},
    forwardedProps: {},
    ...overrides,
  };
}

describe("buildA2uiOperationsFromRenderArgs", () => {
  it("emits createSurface + updateComponents using the host catalog id", () => {
    const result = buildA2uiOperationsFromRenderArgs(
      {
        surfaceId: "filings",
        components: [{ id: "root", component: "Column", children: ["title"] }],
      },
      "filing-tracker-catalog",
    );

    expect(result[A2UI_OPERATIONS_KEY]).toEqual([
      {
        version: "v0.9",
        createSurface: {
          surfaceId: "filings",
          catalogId: "filing-tracker-catalog",
        },
      },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "filings",
          components: [
            { id: "root", component: "Column", children: ["title"] },
          ],
        },
      },
    ]);
  });

  it("includes updateDataModel only when data is a non-empty object", () => {
    const withData = buildA2uiOperationsFromRenderArgs(
      { surfaceId: "s", components: [], data: { status: "pending" } },
      "cat",
    );
    expect(withData[A2UI_OPERATIONS_KEY]).toHaveLength(3);
    expect(withData[A2UI_OPERATIONS_KEY][2]).toEqual({
      version: "v0.9",
      updateDataModel: {
        surfaceId: "s",
        path: "/",
        value: { status: "pending" },
      },
    });

    expect(
      buildA2uiOperationsFromRenderArgs(
        { surfaceId: "s", components: [], data: {} },
        "cat",
      )[A2UI_OPERATIONS_KEY],
    ).toHaveLength(2);
  });
});

describe("catalogIdFromA2UIContext", () => {
  it("reads catalogId from the frontend schema context entry", () => {
    expect(
      catalogIdFromA2UIContext(
        input({
          context: [
            {
              description: "A2UI Component Schema — available components",
              value: JSON.stringify({
                catalogId: "filing-tracker-catalog",
                components: {},
              }),
            },
          ],
        }),
      ),
    ).toBe("filing-tracker-catalog");
  });

  it("falls back to the v0.9 basic catalog when no schema is forwarded", () => {
    expect(catalogIdFromA2UIContext(input())).toBe(
      "https://a2ui.org/specification/v0_9/basic_catalog.json",
    );
  });
});

async function hostProvidedExecute() {
  return { custom: true };
}

describe("withA2UIRenderToolExecutors", () => {
  it("attaches execute to render_a2ui and leaves other tools as client tools", async () => {
    const tools = {
      render_a2ui: { description: "render" },
      other_tool: { description: "frontend" },
    } as unknown as ToolSet;

    const next = withA2UIRenderToolExecutors(tools, input());

    expect(typeof next.render_a2ui.execute).toBe("function");
    expect(next.other_tool.execute).toBeUndefined();

    const envelope = await next.render_a2ui.execute!(
      {
        surfaceId: "s1",
        components: [{ id: "root", component: "Text", text: "hi" }],
      },
      { toolCallId: "tc-1", messages: [] },
    );
    expect(envelope).toEqual(
      buildA2uiOperationsFromRenderArgs(
        {
          surfaceId: "s1",
          components: [{ id: "root", component: "Text", text: "hi" }],
        },
        catalogIdFromA2UIContext(input()),
      ),
    );
  });

  it("does not overwrite a host-provided execute", () => {
    const tools = {
      render_a2ui: { description: "render", execute: hostProvidedExecute },
    } as unknown as ToolSet;

    const next = withA2UIRenderToolExecutors(tools, input());
    expect(next.render_a2ui.execute).toBe(hostProvidedExecute);
  });

  it("attaches execute under a custom injectA2UITool name", () => {
    const tools = {
      draw_ui: { description: "render" },
    } as unknown as ToolSet;

    const next = withA2UIRenderToolExecutors(
      tools,
      input({ forwardedProps: { injectA2UITool: "draw_ui" } }),
    );
    expect(typeof next.draw_ui.execute).toBe("function");
  });
});

describe("a2uiRenderToolNames", () => {
  it("always includes the default render_a2ui name", () => {
    expect([...a2uiRenderToolNames(input())]).toContain("render_a2ui");
  });
});
