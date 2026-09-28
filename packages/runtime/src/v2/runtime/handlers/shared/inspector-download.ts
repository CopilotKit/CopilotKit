/** Maximum product export size, matching the Intelligence export contract. */
export const INSPECTOR_EXPORT_MAX_BYTES = 50 * 1024 * 1024;

/** Streams an export with a byte cap and only the public download headers. */
export async function inspectorDownloadResponse(
  response: Response,
): Promise<Response> {
  const contentType = response.headers.get("content-type") ?? "";
  if (
    !["application/json", "text/csv"].includes(
      contentType.split(";")[0].trim().toLowerCase(),
    ) ||
    !response.body
  ) {
    await response.body?.cancel();
    throw new Error("Invalid export response");
  }
  if (
    Number(response.headers.get("content-length")) > INSPECTOR_EXPORT_MAX_BYTES
  ) {
    await response.body.cancel();
    return Response.json(
      { error: "Export is too large" },
      { status: 413, headers: { "Cache-Control": "no-store, private" } },
    );
  }
  let bytes = 0;
  const bounded = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        if (bytes > INSPECTOR_EXPORT_MAX_BYTES)
          throw new Error("Export is too large");
        controller.enqueue(chunk);
      },
    }),
  );
  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": "no-store, private",
    "X-Content-Type-Options": "nosniff",
  });
  const metadata = response.headers.get("x-export-metadata");
  if (metadata && metadata.length <= 65536)
    headers.set("X-Export-Metadata", metadata);
  return new Response(bounded, { headers });
}
