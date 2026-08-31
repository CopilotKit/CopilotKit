import { describe, it, expect, vi } from "vitest";
import { WhatsAppClient } from "./client.js";

function fakeFetch(
  impl: (url: string, init?: RequestInit) => Promise<Response>,
) {
  return vi.fn(impl) as unknown as typeof fetch;
}

describe("WhatsAppClient", () => {
  it("POSTs a message to the messages endpoint with auth + messaging_product", async () => {
    const calls: Array<{ url: string; body: any; auth?: string }> = [];
    const client = new WhatsAppClient({
      accessToken: "TOK",
      phoneNumberId: "PNID",
      apiVersion: "v21.0",
      graphBaseUrl: "https://graph.test",
      fetchImpl: fakeFetch(async (url, init) => {
        calls.push({
          url: url as string,
          body: JSON.parse((init?.body as string) ?? "{}"),
          auth: (init?.headers as Record<string, string>)?.Authorization,
        });
        return new Response(
          JSON.stringify({ messages: [{ id: "wamid.OUT" }] }),
          { status: 200 },
        );
      }),
    });

    const ref = await client.sendMessage("15551234567", {
      type: "text",
      text: { body: "hi", preview_url: false },
    });

    expect(calls[0]!.url).toBe("https://graph.test/v21.0/PNID/messages");
    expect(calls[0]!.auth).toBe("Bearer TOK");
    expect(calls[0]!.body).toMatchObject({
      messaging_product: "whatsapp",
      to: "15551234567",
      type: "text",
    });
    expect(ref).toEqual({
      id: "wamid.OUT",
      to: "15551234567",
      phoneNumberId: "PNID",
    });
  });

  it("throws on a non-2xx response", async () => {
    const client = new WhatsAppClient({
      accessToken: "TOK",
      phoneNumberId: "PNID",
      fetchImpl: fakeFetch(async () => new Response("bad", { status: 400 })),
    });
    await expect(
      client.sendMessage("x", {
        type: "text",
        text: { body: "y", preview_url: false },
      }),
    ).rejects.toThrow(/400/);
  });

  it("downloads media in two hops (metadata then bytes)", async () => {
    const client = new WhatsAppClient({
      accessToken: "TOK",
      phoneNumberId: "PNID",
      apiVersion: "v21.0",
      graphBaseUrl: "https://graph.test",
      fetchImpl: fakeFetch(async (url) => {
        if ((url as string).endsWith("/MEDIA_ID")) {
          return new Response(
            JSON.stringify({
              url: "https://cdn.test/blob",
              mime_type: "image/png",
            }),
            {
              status: 200,
            },
          );
        }
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      }),
    });
    const res = await client.downloadMedia("MEDIA_ID");
    expect(res.mimeType).toBe("image/png");
    expect(Array.from(res.bytes)).toEqual([1, 2, 3]);
  });

  it("sends a read receipt with a typing indicator", async () => {
    let sent: any;
    const client = new WhatsAppClient({
      accessToken: "TOK",
      phoneNumberId: "PNID",
      apiVersion: "v21.0",
      graphBaseUrl: "https://graph.test",
      fetchImpl: fakeFetch(async (url, init) => {
        sent = { url, body: JSON.parse((init?.body as string) ?? "{}") };
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }),
    });
    await client.sendReadReceipt("wamid.IN", { typing: true });
    expect(sent.url).toBe("https://graph.test/v21.0/PNID/messages");
    expect(sent.body).toEqual({
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.IN",
      typing_indicator: { type: "text" },
    });
  });

  it("sends a plain read receipt without typing when not requested", async () => {
    let body: any;
    const client = new WhatsAppClient({
      accessToken: "TOK",
      phoneNumberId: "PNID",
      fetchImpl: fakeFetch(async (_url, init) => {
        body = JSON.parse((init?.body as string) ?? "{}");
        return new Response("{}", { status: 200 });
      }),
    });
    await client.sendReadReceipt("wamid.IN");
    expect(body.typing_indicator).toBeUndefined();
    expect(body.status).toBe("read");
  });
});
