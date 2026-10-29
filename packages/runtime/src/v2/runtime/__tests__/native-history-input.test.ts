import { expect, test } from "vitest";
import { nativeHistoryInput } from "../handlers/intelligence/native-history-input";

const user = { id: "occurrence-1", role: "user" as const, content: "repeat" };
const tool = {
  id: "result-1",
  role: "tool" as const,
  toolCallId: "call-1",
  content: '{"approved":true}',
};
test.each(["approved", "declined"])(
  "%s history is not replayed on subsequent or cold-restored turns",
  (outcome) => {
    const result = { ...tool, content: JSON.stringify({ outcome }) };
    const next = { ...user, id: "occurrence-2" };
    expect(nativeHistoryInput([user, result, next], [user, result])).toEqual([
      next,
    ]);
    const after = { ...user, id: "occurrence-3" };
    expect(
      nativeHistoryInput([user, result, next, after], [user, result, next]),
    ).toEqual([after]);
  },
);
test("new and same-ID resolved tool results survive", () => {
  expect(nativeHistoryInput([tool], [])).toEqual([tool]);
  expect(nativeHistoryInput([tool], [{ ...tool, content: "pending" }])).toEqual(
    [tool],
  );
});
test("tool-only assistant replay uses the saved wire shape", () => {
  expect(
    nativeHistoryInput(
      [
        {
          id: "a",
          role: "assistant",
          toolCalls: [
            {
              id: "c",
              type: "function",
              function: { name: "f", arguments: "{}" },
            },
          ],
        },
      ],
      [
        {
          id: "a",
          role: "assistant",
          content: "",
          toolCalls: [{ id: "c", name: "f", args: "{}" }],
        },
      ],
    ),
  ).toEqual([]);
});
test("ambiguous IDs and edits fail before native execution", () => {
  expect(() => nativeHistoryInput([user, user], [])).toThrow("Ambiguous input");
  expect(() => nativeHistoryInput([user], [user, user])).toThrow(
    "Ambiguous persisted",
  );
  expect(() =>
    nativeHistoryInput([{ ...user, content: "edit" }], [user]),
  ).toThrow("Cannot edit");
  expect(() =>
    nativeHistoryInput([{ ...tool, toolCallId: "different" }], [tool]),
  ).toThrow("Cannot edit");
});

test("parallel frontend results do not repeat the native assistant tool calls", () => {
  const calls = ["pie", "bar"].map((id) => ({
    id,
    type: "function" as const,
    function: { name: id, arguments: "{}" },
  }));
  const assistant = {
    id: "assistant",
    role: "assistant" as const,
    toolCalls: calls,
  };
  const results = calls.map(({ id }) => ({
    id: `${id}-result`,
    role: "tool" as const,
    toolCallId: id,
    content: "rendered",
  }));
  const history = [
    user,
    {
      id: assistant.id,
      role: assistant.role,
      toolCalls: calls.map((call) => ({
        id: call.id,
        name: call.function.name,
        args: call.function.arguments,
      })),
    },
  ];
  expect(nativeHistoryInput([user, assistant, ...results], history)).toEqual(
    results,
  );
});

test("JSON formatting changes from a native call replay do not edit persisted history", () => {
  const call = { id: "call", name: "scheduleTime", args: '{"duration":30}' };
  const previous = {
    id: "original-owner",
    role: "assistant",
    content: "",
    toolCalls: [call],
  };
  const replay = {
    id: previous.id,
    role: "assistant" as const,
    toolCalls: [
      {
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: '{\n  "duration": 30\n}' },
      },
    ],
  };
  expect(nativeHistoryInput([replay], [previous])).toEqual([]);
  expect(() =>
    nativeHistoryInput(
      [
        {
          ...replay,
          toolCalls: [
            {
              ...replay.toolCalls[0],
              function: { name: call.name, arguments: '{"duration":60}' },
            },
          ],
        },
      ],
      [previous],
    ),
  ).toThrow("Cannot edit");
});
