import { test } from "node:test";
import assert from "node:assert/strict";
import { completedTurns } from "../import/fixtures/native-sources.mjs";
import {
  inspectMastra,
  inspectStrands,
  inspectTranscript,
} from "../import/fixtures/completed-native.mjs";

test("controlled native projections retain ordered original calls, result association and state", () => {
  const turns = completedTurns("projection");
  const mastra = {
    thread: { metadata: { workingMemory: JSON.stringify(turns.state) } },
    messages: turns.calls.map((tool) => ({
      content: {
        parts: [
          {
            type: "tool-invocation",
            toolInvocation: {
              state: "result",
              toolCallId: tool.id,
              toolName: tool.name,
              args: tool.args,
              result: tool.result,
            },
          },
        ],
      },
    })),
  };
  const strands = {
    data: {
      state: turns.state,
      interrupts: { interrupts: {} },
      messages: turns.calls.flatMap((tool) => [
        {
          content: [
            {
              toolUse: {
                toolUseId: tool.id,
                name: tool.name,
                input: tool.args,
              },
            },
          ],
        },
        {
          content: [
            {
              toolResult: {
                toolUseId: tool.id,
                content: [{ json: tool.result }],
              },
            },
          ],
        },
      ]),
    },
  };
  assert.deepEqual(inspectMastra(mastra), inspectStrands(strands));
  strands.data.messages[1].content[0].toolResult.toolUseId = "wrong-call";
  assert.notDeepEqual(inspectMastra(mastra), inspectStrands(strands));
});

test("API text identity decoding is explicit and rejects changed tracking IDs or segments", () => {
  const native = {
    id: "native-tracking",
    kind: "text",
    role: "assistant",
    payload: "Original",
  };
  const message = {
    id: 'native:"native-tracking":segment:0',
    role: "assistant",
    content: "Original",
  };
  assert.deepEqual(inspectTranscript([message]), [native]);
  assert.notDeepEqual(inspectTranscript([{ ...message, role: "user" }]), [
    native,
  ]);
  for (const id of [
    'native:"different":segment:0',
    'native:"native-tracking":segment:1',
  ])
    assert.notDeepEqual(inspectTranscript([{ ...message, id }]), [native]);
});

test("unsupported native and imported content must fail instead of being omitted", () => {
  assert.throws(
    () =>
      inspectMastra({
        messages: [{ content: { parts: [{ type: "reasoning" }] } }],
      }),
    /Uncovered/,
  );
  assert.throws(
    () =>
      inspectStrands({ data: { messages: [{ content: [{ image: {} }] }] } }),
    /Uncovered/,
  );
  assert.throws(
    () =>
      inspectTranscript([
        { id: "image", role: "user", content: [{ type: "image" }] },
      ]),
    /Uncovered/,
  );
});
