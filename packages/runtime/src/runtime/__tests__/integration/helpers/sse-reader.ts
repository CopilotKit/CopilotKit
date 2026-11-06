/**
 * Read an SSE response stream to a string.
 * Stops when RUN_FINISHED is seen or after maxChunks reads.
 */
export async function readSSEStream(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stream: ReadableStream<any>,
  opts: { maxChunks?: number } = {},
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  const maxChunks = opts.maxChunks ?? 30;

  for (let i = 0; i < maxChunks; i++) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      // The stream may emit strings (direct fetch handler) or Uint8Array (real HTTP)
      output +=
        typeof value === "string"
          ? value
          : decoder.decode(value, { stream: true });
      if (output.includes("RUN_FINISHED")) break;
    }
  }

  await reader.cancel();
  output += decoder.decode();
  return output;
}

/**
 * Extract event type names from an SSE payload string.
 * Matches "type":"EVENT_NAME" patterns in the data lines.
 */
export function extractEventTypes(ssePayload: string): string[] {
  const types: string[] = [];
  for (const line of ssePayload.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const match = line.match(/"type"\s*:\s*"([^"]+)"/);
    if (match?.[1]) types.push(match[1]);
  }
  return types;
}
