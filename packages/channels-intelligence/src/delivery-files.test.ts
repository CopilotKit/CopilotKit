import { expect, test, vi } from "vitest";
import { ChannelDeliveryFileClient } from "./delivery-files.js";

test("image uploads carry an allowlisted MIME inferred from the filename", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    return new Response(JSON.stringify({ handle: "file_image_1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const client = new ChannelDeliveryFileClient({
    baseUrl: "https://intelligence.example",
    apiKey: "test-key",
    fetch,
  });

  await client.uploadFile("delivery-1", "response_image_upload_01", {
    bytes: new Uint8Array([137, 80, 78, 71]),
    filename: "chart.PNG",
  });

  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0]?.[0]).toContain(
    "operationId=response_image_upload_01",
  );
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
  const client = new ChannelDeliveryFileClient({
    baseUrl: "https://intelligence.example",
    apiKey: "test-key",
    fetch,
  });

  await client.uploadFile("delivery-1", "response_file_upload_01", {
    bytes: new Uint8Array([1, 2, 3]),
    filename: "report.pdf",
  });

  expect(fetch.mock.calls[0]?.[1]).toMatchObject({
    headers: {
      "content-type": "application/octet-stream",
    },
  });
});

test("storage retries reuse one operation identity", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockRejectedValueOnce(new Error("connection reset"))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ handle: "file_retry_1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  const client = new ChannelDeliveryFileClient({
    baseUrl: "https://intelligence.example",
    apiKey: "test-key",
    fetch,
  });

  await expect(
    client.uploadFile("delivery-1", "response_storage_retry_01", {
      bytes: new Uint8Array([1, 2, 3]),
      filename: "report.pdf",
    }),
  ).resolves.toEqual({ handle: "file_retry_1" });

  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
    expect.stringContaining("operationId=response_storage_retry_01"),
    expect.stringContaining("operationId=response_storage_retry_01"),
  ]);
});
