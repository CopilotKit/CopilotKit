import type { Message } from "@ag-ui/core";
import { getMessagesMemoKey } from "../CopilotChat";

describe("getMessagesMemoKey", () => {
  const baseMessage = {
    id: "message-1",
    role: "user",
    content: "Hello",
  } as Message;

  it("changes when only the message timestamp changes", () => {
    const withoutTimestamp = getMessagesMemoKey([baseMessage]);
    const withCreatedAt = getMessagesMemoKey([
      {
        ...baseMessage,
        createdAt: "2026-07-16T09:30:00.000Z",
      } as unknown as Message,
    ]);
    const withTimestamp = getMessagesMemoKey([
      { ...baseMessage, timestamp: 1_700_000_000 } as unknown as Message,
    ]);

    expect(withCreatedAt).not.toBe(withoutTimestamp);
    expect(withTimestamp).not.toBe(withoutTimestamp);
    expect(withCreatedAt).not.toBe(withTimestamp);
  });
});
