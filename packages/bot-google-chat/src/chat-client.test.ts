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

  it("throws when a 2xx response is missing the message name", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    const c = makeClient(fetchImpl);
    await expect(c.createMessage("spaces/A", { text: "hi" })).rejects.toThrow(/missing message name/);
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

describe("ChatClient.uploadAttachment", () => {
  it("uploads media then creates a message referencing the attachment", async () => {
    const fetchImpl = vi.fn(async (input: any) => {
      const url = String(input);
      if (url.includes("attachments:upload")) {
        return new Response(
          JSON.stringify({ attachmentDataRef: { resourceName: "RES_NAME", attachmentUploadToken: "TOK" } }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ name: "spaces/A/messages/M2" }), { status: 200 });
    });
    const c = makeClient(fetchImpl);
    const res = await c.uploadAttachment("spaces/A", new Uint8Array([1, 2, 3]), "file.txt");

    expect(res).toEqual({ ok: true, fileId: "RES_NAME" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    // Step 1: media upload endpoint on the /upload/v1 base.
    const [uploadUrl, uploadInit] = (fetchImpl.mock.calls[0] as any[])!;
    expect(String(uploadUrl)).toContain("/upload/v1/spaces/A/attachments:upload");
    expect(String(uploadUrl)).toContain("uploadType=multipart");
    expect((uploadInit.headers as any).Authorization).toBe("Bearer tok");
    expect(uploadInit.method).toBe("POST");

    // Step 2: create message on the REST base referencing the attachment.
    const [createUrl, createInit] = (fetchImpl.mock.calls[1] as any[])!;
    expect(String(createUrl)).toContain("/v1/spaces/A/messages");
    expect(String(createUrl)).not.toContain("/upload/v1");
    const body = JSON.parse(createInit.body);
    expect(body.attachment[0].attachmentDataRef).toEqual({ resourceName: "RES_NAME", attachmentUploadToken: "TOK" });
  });

  it("returns ok:false without creating a message when the upload fails", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 }));
    const c = makeClient(fetchImpl);
    const res = await c.uploadAttachment("spaces/A", new Uint8Array([1]), "f.txt");
    expect(res.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("ChatClient error handling", () => {
  it("throws on a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 403 }));
    const c = makeClient(fetchImpl);
    await expect(c.createMessage("spaces/A", { text: "hi" })).rejects.toThrow(/403/);
  });
});
