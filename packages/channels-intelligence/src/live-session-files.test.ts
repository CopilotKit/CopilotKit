import { expect, test, vi } from "vitest";
import { LiveSessionFileClient } from "./live-session-files.js";

test("image uploads carry an allowlisted MIME inferred from the filename", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    return new Response(JSON.stringify({ handle: "file_image_1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const client = new LiveSessionFileClient({
    baseUrl: "https://intelligence.example",
    apiKey: "test-key",
    fetch,
  });

  await client.uploadFile("delivery-1", {
    bytes: new Uint8Array([137, 80, 78, 71]),
    filename: "chart.PNG",
  });

  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({
    headers: {
      authorization: "Bearer test-key",
      "content-type": "image/png",
    },
  });
});

test("general file uploads keep the binary MIME", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    return new Response(JSON.stringify({ handle: "file_document_1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const client = new LiveSessionFileClient({
    baseUrl: "https://intelligence.example",
    apiKey: "test-key",
    fetch,
  });

  await client.uploadFile("delivery-1", {
    bytes: new Uint8Array([1, 2, 3]),
    filename: "report.pdf",
  });

  expect(fetch.mock.calls[0]?.[1]).toMatchObject({
    headers: {
      "content-type": "application/octet-stream",
    },
  });
});
