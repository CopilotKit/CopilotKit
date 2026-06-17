import { describe, it, expect, vi } from "vitest";
import { GoogleChatAdapter } from "./adapter.js";
import type { BotNode } from "@copilotkit/bot-ui";

function makeAdapter() {
  const chatClient = {
    createMessage: vi.fn(async () => ({ name: "spaces/A/messages/M1" })),
    patchMessage: vi.fn(async () => {}),
    deleteMessage: vi.fn(async () => {}),
    listMessages: vi.fn(async () => []),
    uploadAttachment: vi.fn(async () => ({ ok: true, fileId: "f1" })),
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

  it("stream() patches the placeholder text-only (mask 'text', not 'text,cardsV2')", async () => {
    const { adapter, chatClient } = makeAdapter();
    async function* chunks() {
      yield "hello world";
    }
    await adapter.stream(
      { space: "spaces/A", thread: "spaces/A/threads/T" } as unknown,
      chunks(),
    );
    // The streaming updateAt closure must use the "text" mask so it never
    // clears an existing cardsV2 payload on the edited message.
    expect(chatClient.patchMessage).toHaveBeenCalled();
    for (const call of chatClient.patchMessage.mock.calls as any[]) {
      expect(call[2]).toBe("text");
    }
  });

  it("delete() removes the message", async () => {
    const { adapter, chatClient } = makeAdapter();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await adapter.delete({ id: "spaces/A/messages/M1" } as any);
    expect(chatClient.deleteMessage).toHaveBeenCalledWith("spaces/A/messages/M1");
  });

  it("getMessages() scopes the listing to the thread when target.thread is set", async () => {
    const { adapter, chatClient } = makeAdapter();
    await adapter.getMessages({ space: "spaces/A", thread: "spaces/A/threads/T" } as unknown);
    expect(chatClient.listMessages).toHaveBeenCalledTimes(1);
    const args = chatClient.listMessages.mock.calls[0] as any[];
    expect(args[0]).toBe("spaces/A");
    expect(args[1]).toEqual({ threadName: "spaces/A/threads/T" });
  });

  it("getMessages() lists the whole space when target.thread is absent", async () => {
    const { adapter, chatClient } = makeAdapter();
    await adapter.getMessages({ space: "spaces/A" } as unknown);
    const args = chatClient.listMessages.mock.calls[0] as any[];
    expect(args[0]).toBe("spaces/A");
    expect(args[1]).toBeUndefined();
  });

  it("postFile() threads the upload when target.thread is set", async () => {
    const { adapter, chatClient } = makeAdapter();
    const bytes = new Uint8Array([1, 2, 3]);
    await adapter.postFile(
      { space: "spaces/A", thread: "spaces/A/threads/T" } as unknown,
      { bytes, filename: "f.png" },
    );
    expect(chatClient.uploadAttachment).toHaveBeenCalledTimes(1);
    const args = chatClient.uploadAttachment.mock.calls[0] as any[];
    expect(args[0]).toBe("spaces/A");
    expect(args[1]).toBe(bytes);
    expect(args[2]).toBe("f.png");
    expect(args[3]).toEqual({ threadName: "spaces/A/threads/T" });
  });

  it("postFile() posts top-level (no threadName) when target.thread is absent", async () => {
    const { adapter, chatClient } = makeAdapter();
    await adapter.postFile(
      { space: "spaces/A" } as unknown,
      { bytes: new Uint8Array([1]), filename: "f.png" },
    );
    const args = chatClient.uploadAttachment.mock.calls[0] as any[];
    expect(args[3]).toBeUndefined();
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
