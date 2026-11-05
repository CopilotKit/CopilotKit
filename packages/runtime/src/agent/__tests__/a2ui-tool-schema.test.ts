/**
 * Frontend tool schemas reach the model as sent. The classic agent does not
 * close open objects, so A2UI components keep their model-visible fields.
 */
import { expect, test } from "vitest";
import { EventType } from "@ag-ui/client";
import { RENDER_A2UI_TOOL } from "@ag-ui/a2ui-middleware";
import { eventsOfType, runClassicAgent } from "./agent-test-helpers";

test("A2UI component objects keep their model-visible fields open", async () => {
  const args = {
    surfaceId: "s1",
    components: [
      { id: "root", component: "Text", text: { literalString: "Hi" } },
    ],
    data: { form: { name: "Alice" } },
  };

  const { events, requests } = await runClassicAgent(
    {},
    [{ toolCalls: [{ id: "tc-1", name: "render_a2ui", input: args }] }],
    { tools: [RENDER_A2UI_TOOL] },
  );

  // An omitted additionalProperties permits fields. The exact schema,
  // descriptions included, reaches the model.
  const a2ui = requests[0]?.tools?.find((t) => t.name === "render_a2ui");
  expect(a2ui?.inputSchema).toEqual(RENDER_A2UI_TOOL.parameters);
  // The extra component fields pass validation: no error result.
  expect(eventsOfType(events, EventType.TOOL_CALL_RESULT)).toEqual([]);
});

test("AG-UI tools preserve explicit constraints and local references", async () => {
  const parameters = {
    type: "object",
    additionalProperties: false,
    properties: {
      label: { $ref: "#/$defs/label" },
      count: { type: "integer", minimum: 1, maximum: 10 },
    },
    required: ["label", "count"],
    $defs: { label: { type: "string", minLength: 1 } },
  };

  const { requests } = await runClassicAgent({}, [{}], {
    tools: [{ name: "draw", description: "Draw labeled shapes", parameters }],
  });

  expect(requests[0]?.tools?.[0]).toMatchObject({
    name: "draw",
    inputSchema: parameters,
  });
});
