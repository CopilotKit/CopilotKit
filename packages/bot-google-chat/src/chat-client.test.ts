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

describe("ChatClient.listMessages", () => {
  it("requests the most-recent messages (orderBy desc) and returns them chronologically, no filter without threadName", async () => {
    // API returns newest→oldest (because orderBy=createTime desc); we expect
    // the returned array to be reversed to oldest→newest.
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            messages: [
              { name: "spaces/A/messages/M3", text: "third", createTime: "2026-01-03T00:00:00Z" },
              { name: "spaces/A/messages/M2", text: "second", createTime: "2026-01-02T00:00:00Z" },
              { name: "spaces/A/messages/M1", text: "first", createTime: "2026-01-01T00:00:00Z" },
            ],
          }),
          { status: 200 },
        ),
    );
    const c = makeClient(fetchImpl);
    const res = await c.listMessages("spaces/A");

    expect(res.map((m) => m.text)).toEqual(["first", "second", "third"]);

    const [url, init] = (fetchImpl.mock.calls[0] as any[])!;
    expect(init.method).toBe("GET");
    // orderBy=createTime desc ("createTime desc" URL-encodes the space as +).
    expect(String(url)).toContain("orderBy=createTime+desc");
    // No filter param when threadName is absent (whole-space / DM scope).
    expect(String(url)).not.toContain("filter=");
    expect(String(url)).toContain("pageSize=100");
  });

  it("scopes to a thread via the filter param when threadName is provided", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            messages: [
              { name: "spaces/A/messages/M2", text: "newer", createTime: "2026-01-02T00:00:00Z" },
              { name: "spaces/A/messages/M1", text: "older", createTime: "2026-01-01T00:00:00Z" },
            ],
          }),
          { status: 200 },
        ),
    );
    const c = makeClient(fetchImpl);
    const res = await c.listMessages("spaces/A", { threadName: "spaces/A/threads/T", pageSize: 50 });

    // Returned chronologically (oldest→newest) after reversing the desc page.
    expect(res.map((m) => m.text)).toEqual(["older", "newer"]);

    const [url] = (fetchImpl.mock.calls[0] as any[])!;
    const parsed = new URL(String(url));
    // filter scopes to the thread (value is URL-decoded by URL parsing).
    expect(parsed.searchParams.get("filter")).toBe('thread.name = "spaces/A/threads/T"');
    expect(parsed.searchParams.get("orderBy")).toBe("createTime desc");
    expect(parsed.searchParams.get("pageSize")).toBe("50");
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

  it("throws (without issuing a request) when name is empty", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const c = makeClient(fetchImpl);
    await expect(c.patchMessage("", { text: "x" }, "text")).rejects.toThrow(
      /patchMessage: empty message name/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("ChatClient.deleteMessage", () => {
  it("DELETEs the message resource", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const c = makeClient(fetchImpl);
    await c.deleteMessage("spaces/A/messages/M1");
    const [url, init] = (fetchImpl.mock.calls[0] as any[])!;
    expect(init.method).toBe("DELETE");
    expect(String(url)).toContain("/spaces/A/messages/M1");
  });

  it("throws (without issuing a request) when name is empty", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const c = makeClient(fetchImpl);
    await expect(c.deleteMessage("")).rejects.toThrow(
      /deleteMessage: empty message name/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
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

  it("posts the attachment message into the thread when threadName is provided", async () => {
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
    const res = await c.uploadAttachment("spaces/A", new Uint8Array([1, 2, 3]), "file.txt", {
      threadName: "spaces/A/threads/T",
    });

    expect(res).toEqual({ ok: true, fileId: "RES_NAME" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    // Step 2: create-message step threads the attachment and uses the
    // fallback-to-new-thread reply option.
    const [createUrl, createInit] = (fetchImpl.mock.calls[1] as any[])!;
    expect(String(createUrl)).toContain("messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD");
    const body = JSON.parse(createInit.body);
    expect(body.thread).toEqual({ name: "spaces/A/threads/T" });
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
