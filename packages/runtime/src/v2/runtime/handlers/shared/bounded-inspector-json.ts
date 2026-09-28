/** A bounded Inspector body exceeded its byte limit. */
export class InspectorBodyTooLargeError extends Error {}

/** Reads a JSON stream with a byte cap, including when Content-Length is absent. */
export async function readInspectorJson(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<unknown> {
  if (!body) throw new SyntaxError("Missing JSON body");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new InspectorBodyTooLargeError("Inspector body is too large");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}
