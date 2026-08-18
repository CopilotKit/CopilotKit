import { describe, it, expect } from "vitest";
import { EventType } from "@ag-ui/client";
import { A2UIMiddleware } from "@ag-ui/a2ui-middleware";
import type { BaseEvent } from "@ag-ui/client";
import {
  createClassicAgentWithTools,
  createDefaultInput,
  collectEvents,
  toolCall,
  finish,
  eventField,
} from "./agent-test-helpers";
import {
  A2UI_OPERATIONS_KEY,
  buildA2uiOperationsFromRenderArgs,
} from "../a2ui-render-tool";

const RENDER_A2UI_TOOL = {
  name: "render_a2ui",
  description: "Render a dynamic A2UI v0.9 surface",
  parameters: {
    type: "object" as const,
    properties: {
      surfaceId: { type: "string" },
      components: { type: "array", items: { type: "object" } },
      data: { type: "object" },
    },
    required: ["surfaceId", "components"],
  },
};

const RENDER_ARGS = {
  surfaceId: "filings",
  components: [
    { id: "root", component: "Column", children: ["title"] },
    { id: "title", component: "Text", text: "Pending FDA filings" },
  ],
};

const SCHEMA_CONTEXT = {
  description:
    "A2UI Component Schema — available components for generating UI surfaces",
  value: JSON.stringify({
    catalogId: "filing-tracker-catalog",
    components: {},
  }),
};

describe("BuiltInAgent A2UI render_a2ui (#6526)", () => {
  it("emits TOOL_CALL_RESULT with a2ui_operations when the model calls render_a2ui", async () => {
    const agent = createClassicAgentWithTools(
      [toolCall("tc-1", "render_a2ui", RENDER_ARGS), finish()],
      [],
    );

    const events = await collectEvents(
      agent.run(
        createDefaultInput({
          messages: [
            { id: "u1", role: "user", content: "show pending filings" },
          ] as never,
          tools: [RENDER_A2UI_TOOL],
          context: [SCHEMA_CONTEXT],
        }),
      ),
    );

    const result = events.find((e) => e.type === EventType.TOOL_CALL_RESULT);
    expect(result).toBeDefined();
    const content = JSON.parse(eventField<string>(result!, "content"));
    expect(content[A2UI_OPERATIONS_KEY]).toEqual(
      buildA2uiOperationsFromRenderArgs(RENDER_ARGS, "filing-tracker-catalog")[
        A2UI_OPERATIONS_KEY
      ],
    );
  });

  it("emits ACTIVITY_SNAPSHOT when A2UIMiddleware wraps BuiltInAgent", async () => {
    const agent = createClassicAgentWithTools(
      [toolCall("tc-1", "render_a2ui", RENDER_ARGS), finish()],
      [],
    );
    agent.use(new A2UIMiddleware({ injectA2UITool: true }));

    const events: BaseEvent[] = [];
    await agent.runAgent(
      createDefaultInput({
        messages: [
          { id: "u1", role: "user", content: "show pending filings" },
        ] as never,
        context: [SCHEMA_CONTEXT],
      }),
      {
        onEvent: ({ event }) => {
          events.push(event);
        },
      },
    );

    const snapshots = events.filter(
      (e) => e.type === EventType.ACTIVITY_SNAPSHOT,
    );
    expect(snapshots.length).toBeGreaterThan(0);
    expect(
      snapshots.some((e) => eventField(e, "activityType") === "a2ui-surface"),
    ).toBe(true);
    expect(
      snapshots.some((e) => {
        const content = eventField<Record<string, unknown>>(e, "content");
        return Array.isArray(content?.[A2UI_OPERATIONS_KEY]);
      }),
    ).toBe(true);
  });
});
