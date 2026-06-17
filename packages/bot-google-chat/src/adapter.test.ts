import { describe, it, expect, vi } from "vitest";
import { GoogleChatAdapter } from "./adapter.js";
import type { BotNode } from "@copilotkit/bot-ui";

function makeAdapter() {
  const chatClient = {
    createMessage: vi.fn(async () => ({ name: "spaces/A/messages/M1" })),
    patchMessage: vi.fn(async () => {}),
    deleteMessage: vi.fn(async () => {}),
    listMessages: vi.fn(async () => []),
  };
  const adapter = new GoogleChatAdapter({ googleChatProjectNumber: "123" });
  (adapter as unknown as { chatClient: unknown }).chatClient = chatClient;
  return { adapter, chatClient };
}
const text = (v: string): BotNode => ({ type: "text", props: { value: v } });

describe("GoogleChatAdapter", () => {
  it("advertises the google-chat platform and parity capabilities", () => {
    const { adapter } = makeAdapter();
    expect(adapter.platform).toBe("google-chat");
    expect(adapter.capabilities.supportsStreaming).toBe(true);
    expect(adapter.capabilities.supportsSuggestedPrompts).toBe(false);
    expect((adapter as unknown as Record<string, unknown>).setSuggestedPrompts).toBeUndefined();
    expect((adapter as unknown as Record<string, unknown>).setThreadTitle).toBeUndefined();
  });

  it("throws when no audience/projectNumber and verification not disabled", () => {
    expect(() => new GoogleChatAdapter({})).toThrow();
  });

  it("post() creates a threaded message and returns a ref", async () => {
    const { adapter, chatClient } = makeAdapter();
    const ref = await adapter.post({ space: "spaces/A", thread: "spaces/A/threads/T" } as unknown, [text("hi")]);
    expect(chatClient.createMessage).toHaveBeenCalledTimes(1);
    const [space, body, opts] = (chatClient.createMessage.mock.calls[0] as any[]);
    expect(space).toBe("spaces/A");
    expect(body).toMatchObject({ text: "hi" });
    expect(opts).toMatchObject({ threadName: "spaces/A/threads/T", replyToThread: true });
    expect((ref as unknown as { id: string }).id).toBe("spaces/A/messages/M1");
  });

  it("update() patches with the text,cardsV2 mask", async () => {
    const { adapter, chatClient } = makeAdapter();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await adapter.update({ id: "spaces/A/messages/M1" } as any, [text("edit")]);
    expect(chatClient.patchMessage).toHaveBeenCalledWith("spaces/A/messages/M1", expect.objectContaining({ text: "edit" }), "text,cardsV2");
  });

  it("delete() removes the message", async () => {
    const { adapter, chatClient } = makeAdapter();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await adapter.delete({ id: "spaces/A/messages/M1" } as any);
    expect(chatClient.deleteMessage).toHaveBeenCalledWith("spaces/A/messages/M1");
  });

  it("decodeInteraction() decodes CARD_CLICKED", () => {
    const { adapter } = makeAdapter();
    const evt = adapter.decodeInteraction({
      type: "CARD_CLICKED", space: { name: "spaces/A", type: "ROOM" },
      message: { name: "spaces/A/messages/M1", thread: { name: "spaces/A/threads/T" } },
      common: { invokedFunction: "ck:z", parameters: [] },
    });
    expect(evt!.id).toBe("ck:z");
  });
});
