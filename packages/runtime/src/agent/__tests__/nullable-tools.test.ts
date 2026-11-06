/**
 * Nullable fields of frontend (AG-UI) tools, through the classic agent: the
 * real `chat()` checks the model's arguments against the tool's JSON Schema.
 * Arguments that pass go to the client (no result); arguments that fail come
 * back as an `Error: …` tool result.
 */
import { expect, test } from "vitest";
import { EventType } from "@ag-ui/client";
import { z as z4 } from "zod/v4";
import { eventsOfType, runClassicAgent } from "./agent-test-helpers";

/**
 * Lets the model call the frontend tool `show_card` once with `args`. Returns
 * the tool's error result, or `undefined` when the arguments were valid.
 */
async function callShowCard(
  parameters: Record<string, unknown>,
  args: unknown,
) {
  const { events } = await runClassicAgent(
    {},
    [{ toolCalls: [{ id: "tc-1", name: "show_card", input: args }] }],
    { tools: [{ name: "show_card", description: "Show a card", parameters }] },
  );
  return eventsOfType(events, EventType.TOOL_CALL_RESULT)[0]?.content;
}

const INVALID = /^Error: Input validation failed for tool show_card: /;

test("frontend nullable anyOf fields accept null without admitting other types", async () => {
  const parameters = {
    type: "object",
    properties: {
      subtitle: { anyOf: [{ type: "string" }, { type: "null" }] },
    },
    required: ["subtitle"],
  };

  expect(await callShowCard(parameters, { subtitle: null })).toBeUndefined();
  expect(
    await callShowCard(parameters, { subtitle: "Details" }),
  ).toBeUndefined();
  expect(await callShowCard(parameters, { subtitle: 42 })).toMatch(INVALID);
  expect(await callShowCard(parameters, {})).toMatch(
    /required property "subtitle"/,
  );
});

test("Zod v4 nullable tool fields survive their emitted JSON Schema", async () => {
  const parameters = z4.toJSONSchema(
    z4.object({ subtitle: z4.string().nullable() }),
  );

  expect(await callShowCard(parameters, { subtitle: null })).toBeUndefined();
  expect(
    await callShowCard(parameters, { subtitle: "Details" }),
  ).toBeUndefined();
  expect(await callShowCard(parameters, { subtitle: false })).toMatch(INVALID);
  expect(await callShowCard(parameters, {})).toMatch(INVALID);
});

test("optional nullable array items preserve null and reject invalid values", async () => {
  const parameters = {
    type: "object",
    properties: {
      values: {
        type: "array",
        items: { oneOf: [{ type: "number" }, { type: "null" }] },
      },
    },
  };

  expect(await callShowCard(parameters, {})).toBeUndefined();
  expect(await callShowCard(parameters, { values: [1, null] })).toBeUndefined();
  expect(await callShowCard(parameters, { values: ["invalid"] })).toMatch(
    INVALID,
  );
});
