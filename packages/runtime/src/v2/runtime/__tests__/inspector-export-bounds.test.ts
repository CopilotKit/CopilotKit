import { expect, test } from "vitest";
import {
  inspectorDownloadResponse,
  INSPECTOR_EXPORT_MAX_BYTES,
} from "../handlers/shared/inspector-download";

test("refuses an oversized declared export before reading the body", async () => {
  const response = await inspectorDownloadResponse(
    new Response("data", {
      headers: {
        "Content-Type": "text/csv",
        "Content-Length": String(INSPECTOR_EXPORT_MAX_BYTES + 1),
      },
    }),
  );
  expect(response.status).toBe(413);
});

test("bounds a streamed export when Content-Length is absent", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(INSPECTOR_EXPORT_MAX_BYTES + 1));
      controller.close();
    },
  });
  const response = await inspectorDownloadResponse(
    new Response(stream, { headers: { "Content-Type": "application/json" } }),
  );
  await expect(response.arrayBuffer()).rejects.toThrow("Export is too large");
});

test("does not forward executable content through an export response", async () => {
  await expect(
    inspectorDownloadResponse(
      new Response("<script>bad()</script>", {
        headers: { "Content-Type": "text/html" },
      }),
    ),
  ).rejects.toThrow("Invalid export response");
});
