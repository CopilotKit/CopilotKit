/**
 * JSON Schema rules of frontend (AG-UI) tools, through the classic agent: the
 * real `chat()` checks the model's arguments against the tool's schema before
 * the call goes to the client. Nullable fields are pinned in
 * nullable-tools.test.ts.
 */
import { expect, test } from "vitest";
import { EventType } from "@ag-ui/client";
import { eventsOfType, runClassicAgent } from "./agent-test-helpers";

/**
 * Lets the model call the frontend tool `show_card` once with `args`. Returns
 * the run's events, the tool's error result (`undefined` when the arguments
 * were valid), and the model request.
 */
async function callShowCard(parameters: Record<string, unknown>, args: unknown) {
  const { events, requests } = await runClassicAgent(
    {},
    [{ toolCalls: [{ id: "tc-1", name: "show_card", input: args }] }],
    { tools: [{ name: "show_card", description: "Show a card", parameters }] },
  );
  const error = eventsOfType(events, EventType.TOOL_CALL_RESULT)[0]?.content;
  return { events, error, request: requests[0]! };
}

const INVALID = /^Error: Input validation failed for tool show_card: /;

test("valid arguments go to the client: no result, and the run finishes", async () => {
  const { events, error } = await callShowCard(
    { type: "object", properties: { title: { type: "string" } } },
    { title: "Hello" },
  );

  expect(error).toBeUndefined();
  expect(eventsOfType(events, EventType.TOOL_CALL_END)).toEqual([
    expect.objectContaining({ toolCallId: "tc-1" }),
  ]);
  expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
});

test("argument validation enforces references and numeric constraints", async () => {
  const parameters = {
    type: "object",
    properties: {
      label: { $ref: "#/$defs/label" },
      count: { type: "integer", minimum: 1, maximum: 10 },
    },
    required: ["label", "count"],
    additionalProperties: false,
    $defs: { label: { type: "string", minLength: 1 } },
  };
  const errorFor = async (args: unknown) =>
    (await callShowCard(parameters, args)).error;

  expect(await errorFor({ label: "Shapes", count: 2 })).toBeUndefined();
  expect(await errorFor({ label: "", count: 2 })).toMatch(
    /#\/label: String is too short/,
  );
  expect(await errorFor({ label: "Shapes", count: 1.5 })).toMatch(
    /#\/count: .*Expected "integer"/,
  );
  expect(await errorFor({ label: "Shapes", count: 11 })).toMatch(INVALID);
  expect(await errorFor({ label: "Shapes", count: 2, extra: true })).toMatch(
    /Property "extra" does not match additional properties schema/,
  );
});

test("open object fields stay open and reach the model unchanged", async () => {
  const parameters = {
    type: "object",
    properties: { component: { type: "object" } },
    required: ["component"],
  };

  const open = await callShowCard(parameters, {
    component: { Text: { text: "Hello" } },
  });
  const wrongType = await callShowCard(parameters, { component: "invalid" });

  expect(open.error).toBeUndefined();
  expect(open.request.tools?.[0]?.inputSchema).toEqual(parameters);
  expect(wrongType.error).toMatch(INVALID);
});

test("argument validation enforces modern tuple constraints", async () => {
  const parameters = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      point: {
        type: "array",
        prefixItems: [{ type: "number" }, { type: "number" }],
        items: false,
        minItems: 2,
      },
    },
    required: ["point"],
  };
  const errorFor = async (args: unknown) =>
    (await callShowCard(parameters, args)).error;

  expect(await errorFor({ point: [1, 2] })).toBeUndefined();
  expect(await errorFor({ point: [1, "invalid"] })).toMatch(/#\/point\/1: /);
  expect(await errorFor({ point: [1, 2, 3] })).toMatch(/#\/point\/2: /);
});
