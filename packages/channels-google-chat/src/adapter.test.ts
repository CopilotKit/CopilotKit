import { describe, it, expect, vi } from "vitest";
import type { ChannelNode } from "@copilotkit/channels-ui";
import { GoogleChatAdapter } from "./adapter.js";
import type { GoogleChatAdapterOptions } from "./types.js";

function makeAdapter(opts: Partial<GoogleChatAdapterOptions> = {}) {
  const chatClient = {
    createMessage: vi.fn(async () => ({
      name: "spaces/A/messages/M1",
      thread: "spaces/A/threads/T",
    })),
    patchMessage: vi.fn(async () => {}),
    deleteMessage: vi.fn(async () => {}),
  };
  const adapter = new GoogleChatAdapter({
    googleChatProjectNumber: "123",
    ...opts,
  });
  (adapter as unknown as { chatClient: unknown }).chatClient = chatClient;
  return { adapter, chatClient };
}
const text = (v: string): ChannelNode => ({
  type: "text",
  props: { value: v },
});
const target = { space: "spaces/A", thread: "spaces/A/threads/T" };

describe("GoogleChatAdapter", () => {
  it("advertises the google-chat platform and its capabilities", () => {
    const { adapter } = makeAdapter();
    expect(adapter.platform).toBe("google-chat");
    expect(adapter.capabilities).toMatchObject({
      supportsMessageEvents: true,
      supportsStreaming: true,
      supportsModals: false,
      supportsReactions: false,
    });
  });

  it("refuses to start without a webhook verifier", () => {
    expect(() => new GoogleChatAdapter({})).toThrow(/endpointUrl/);
    expect(
      () => new GoogleChatAdapter({ disableSignatureVerification: true }),
    ).not.toThrow();
  });

  it("post() replies in the thread and returns a ref with the landed thread", async () => {
    const { adapter, chatClient } = makeAdapter();
    const ref = await adapter.post(target, [text("hi")]);
    expect(chatClient.createMessage).toHaveBeenCalledWith(
      "spaces/A",
      { text: "hi" },
      { threadName: "spaces/A/threads/T", replyToThread: true },
    );
    expect(ref).toEqual({
      id: "spaces/A/messages/M1",
      space: "spaces/A",
      thread: "spaces/A/threads/T",
    });
  });

  it("routes card buttons through endpointUrl on an add-on app", async () => {
    const { adapter, chatClient } = makeAdapter({
      endpointUrl: "https://bot.example.com/chat",
    });
    await adapter.post(target, [
      {
        type: "actions",
        props: {
          children: [
            {
              type: "button",
              props: {
                onClick: { id: "ck:yes" },
                value: true,
                children: [text("Yes")],
              },
            },
          ],
        },
      },
    ]);
    const body = (chatClient.createMessage.mock.calls[0] as unknown[])[1];
    expect(JSON.stringify(body)).toContain(
      '"function":"https://bot.example.com/chat","parameters":[{"key":"actionId","value":"ck:yes"},{"key":"value","value":"true"}]',
    );
  });

  it("update() patches text and cards together", async () => {
    const { adapter, chatClient } = makeAdapter();
    await adapter.update({ id: "spaces/A/messages/M1" }, [text("edit")]);
    expect(chatClient.patchMessage).toHaveBeenCalledWith(
      "spaces/A/messages/M1",
      { text: "edit", cardsV2: [] },
      "text,cards_v2",
    );
  });

  it("stream() edits one message in place and records the reply", async () => {
    const { adapter, chatClient } = makeAdapter();
    async function* chunks() {
      yield "Hello";
      yield " **world**";
    }
    const ref = await adapter.stream(target, chunks());
    expect(ref.id).toBe("spaces/A/messages/M1");
    const lastPatch = chatClient.patchMessage.mock.calls.at(-1) as unknown[];
    expect(lastPatch[1]).toEqual({ text: "Hello *world*" });
    const history = await adapter.getMessages(target);
    expect(history).toMatchObject([{ text: "Hello **world**", isBot: true }]);
  });

  it("keys clicks on a posted message by the thread it landed in", () => {
    const { adapter } = makeAdapter();
    expect(
      adapter.postedConversationKey(target, {
        id: "m",
        thread: "spaces/A/threads/OTHER",
      }),
    ).toBe("gchat:spaces/A/threads/OTHER");
    expect(
      adapter.postedConversationKey({ space: "spaces/DM" }, { id: "m" }),
    ).toBeUndefined();
  });
});
