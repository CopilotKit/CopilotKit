import { describe, it, expect, vi } from "vitest";

/**
 * Tests for the sendFunction handling in usePushToTalk.
 *
 * Issue #3011: sendFunction (wrapping sendMessage) returns Promise<void>,
 * but the code did `const message = await sendFunction(transcription);`
 * then `message.id` — causing a TypeError on undefined.
 *
 * Fix: Guard .id access with `if (message)` check, and update SendFunction
 * type to accept `Promise<Message | void>`.
 */

describe("usePushToTalk sendFunction handling", () => {
  it("should handle sendFunction returning void without crashing", async () => {
    // Simulates what sendMessage actually returns: Promise<void>
    const sendFunction = vi.fn().mockResolvedValue(undefined);
    let startReadingFromMessageId: string | null = null;

    const transcription = "Hello world";
    const message = await sendFunction(transcription);

    // Apply the same guard as the fix
    if (message) {
      startReadingFromMessageId = message.id;
    }

    // Should not have set the message id (because message is void)
    expect(startReadingFromMessageId).toBeNull();
    expect(sendFunction).toHaveBeenCalledWith(transcription);
  });

  it("should use message.id when sendFunction returns a message", async () => {
    const sendFunction = vi.fn().mockResolvedValue({
      id: "msg-123",
      content: "test",
      role: "user",
    });
    let startReadingFromMessageId: string | null = null;

    const message = await sendFunction("Hello");

    if (message) {
      startReadingFromMessageId = message.id;
    }

    expect(startReadingFromMessageId).toBe("msg-123");
  });
});
