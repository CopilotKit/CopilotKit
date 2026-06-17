import { describe, it, expect, vi } from "vitest";
import { ChatClient } from "./chat-client.js";

function makeClient(fetchImpl: any) {
  return new ChatClient({
    tokenProvider: { getToken: async () => "tok" },
    apiUrl: "https://chat.example/v1",
    fetchImpl,
  });
}

describe("ChatClient.createMessage", () => {
  it("POSTs to the space messages endpoint with a bearer token and returns the name", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ name: "spaces/A/messages/M1" }), { status: 200 }));
    const c = makeClient(fetchImpl);
    const res = await c.createMessage("spaces/A", { text: "hi" });
    expect(res.name).toBe("spaces/A/messages/M1");
    const [url, init] = (fetchImpl.mock.calls[0] as any[])!;
    expect(String(url)).toContain("/spaces/A/messages");
    expect((init.headers as any).Authorization).toBe("Bearer tok");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ text: "hi" });
  });

  it("adds messageReplyOption when replying to a thread", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ name: "n" }), { status: 200 }));
    const c = makeClient(fetchImpl);
    await c.createMessage("spaces/A", { text: "hi" }, { threadName: "spaces/A/threads/T", replyToThread: true });
    const [url, init] = (fetchImpl.mock.calls[0] as any[])!;
    expect(String(url)).toContain("messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD");
    expect(JSON.parse(init.body).thread).toEqual({ name: "spaces/A/threads/T" });
  });
});

describe("ChatClient.patchMessage", () => {
  it("PATCHes with an updateMask query param", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const c = makeClient(fetchImpl);
    await c.patchMessage("spaces/A/messages/M1", { text: "x" }, "text,cardsV2");
    const [url, init] = (fetchImpl.mock.calls[0] as any[])!;
    expect(init.method).toBe("PATCH");
    expect(String(url)).toContain("updateMask=text%2CcardsV2");
  });
});

describe("ChatClient error handling", () => {
  it("throws on a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 403 }));
    const c = makeClient(fetchImpl);
    await expect(c.createMessage("spaces/A", { text: "hi" })).rejects.toThrow(/403/);
  });
});
