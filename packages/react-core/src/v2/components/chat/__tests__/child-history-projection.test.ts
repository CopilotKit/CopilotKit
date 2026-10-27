import { expect, it } from "vitest";
import type { Message } from "@ag-ui/core";
import type { ɵChildHistory } from "@copilotkit/core";
import { projectChildHistories } from "../child-history";

const child: ɵChildHistory = {
  namespace: ["child"],
  parentToolCallIds: ["missing"],
  rootMessageIds: [],
  anchorMessageId: "first",
  messages: [{ id: "answer", role: "assistant", content: "Child answer" }],
};
const messages: Message[] = [
  { id: "first", role: "user", content: "First question" },
  { id: "first-answer", role: "assistant", content: "First answer" },
  { id: "second", role: "user", content: "Second question" },
  { id: "second-answer", role: "assistant", content: "Second answer" },
];
it("keeps an unanchored child in its original turn when later turns arrive", () => {
  const projection = projectChildHistories(messages, [child]);
  expect(projection.messages.map((m) => m.id)).toEqual([
    "first",
    "first-answer",
    'cpk-child:["child"]',
    "second",
    "second-answer",
  ]);
  expect(messages).toHaveLength(4);
});
it("uses first retained turn when a replay has no ownership anchor", () => {
  expect(
    projectChildHistories(messages, [{ ...child, anchorMessageId: undefined }])
      .messages[2]?.role,
  ).toBe("activity");
});
it("retains explicit delegation placement and exposes history to custom activity renderers", () => {
  const delegated: Message[] = [
    ...messages,
    {
      id: "delegation",
      role: "assistant",
      toolCalls: [
        {
          id: "missing",
          type: "function",
          function: { name: "delegate", arguments: "{}" },
        },
      ],
    },
  ];
  const projection = projectChildHistories(delegated, [child]);
  expect(projection.messages.at(-2)?.id).toBe("delegation");
  expect(projection.messages.at(-1)).toMatchObject({
    role: "activity",
    content: { history: child },
  });
});
