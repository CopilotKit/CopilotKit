function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function modernAttachment(part: unknown) {
  if (
    !isRecord(part) ||
    part.type !== "binary" ||
    typeof part.mimeType !== "string"
  ) {
    return null;
  }
  const type = /^image\/[a-z0-9.+-]+$/i.test(part.mimeType)
    ? "image"
    : part.mimeType.toLowerCase() === "application/pdf"
      ? "document"
      : null;
  if (!type || part.source !== undefined) return null;
  const source =
    typeof part.data === "string" && part.url === undefined
      ? { type: "data", value: part.data, mimeType: part.mimeType }
      : typeof part.url === "string" && part.data === undefined
        ? { type: "url", value: part.url, mimeType: part.mimeType }
        : null;
  if (!source) return null;
  const { data: _data, url: _url, mimeType: _mimeType, ...rest } = part;
  return { ...rest, type, source };
}

/** Adapt the dedicated Agno wire request without changing client/UI messages. */
export function normalizeMultimodalRequestBody(body: string): string {
  const input: unknown = JSON.parse(body);
  if (!isRecord(input) || !Array.isArray(input.messages)) return body;
  let changed = false;
  const messages = input.messages.map((message: unknown) => {
    if (
      !isRecord(message) ||
      message.role !== "user" ||
      !Array.isArray(message.content)
    ) {
      return message;
    }
    const original: unknown[] = message.content;
    let messageChanged = false;
    const content = original.flatMap((part): unknown[] => {
      const attachment = modernAttachment(part);
      if (!attachment) return [part];
      const mirrored = original.some(
        (candidate) =>
          isRecord(candidate) &&
          candidate.type === attachment.type &&
          isRecord(candidate.source) &&
          candidate.source.type === attachment.source.type &&
          candidate.source.mimeType === attachment.source.mimeType &&
          candidate.source.value === attachment.source.value,
      );
      messageChanged = true;
      return mirrored ? [] : [attachment];
    });
    if (!messageChanged) return message;
    changed = true;
    return { ...message, content };
  });
  return changed ? JSON.stringify({ ...input, messages }) : body;
}

export function createAgnoMultimodalFetch(transport: typeof fetch = fetch) {
  return (url: string, init: RequestInit): Promise<Response> => {
    if (typeof init.body !== "string") return transport(url, init);
    return transport(url, {
      ...init,
      body: normalizeMultimodalRequestBody(init.body),
    });
  };
}
