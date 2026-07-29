/** Opaque app-api file handle and display metadata carried on an inbound turn. */
export interface ChannelFileRef {
  handle: string;
  filename: string;
  mimeType?: string;
  byteSize?: number;
}

/** Hard cap on one inbound file download. */
const MAX_INBOUND_FILE_BYTES = 64 * 1024 * 1024;

async function readCapped(
  response: Response,
  cap: number,
  handle: string,
): Promise<Uint8Array> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > cap) {
      throw new Error(
        `intelligence file ${handle} too large: ${bytes.byteLength} bytes > ${cap} cap`,
      );
    }
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      throw new Error(
        `intelligence file ${handle} too large: exceeded ${cap} byte cap`,
      );
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export interface LiveSessionFileClientConfig {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
}

/** App-api client for live-session file download and upload. */
export class LiveSessionFileClient {
  constructor(private readonly config: LiveSessionFileClientConfig) {}

  private fetchImpl(): typeof fetch {
    const implementation = this.config.fetch ?? globalThis.fetch;
    if (!implementation) {
      throw new Error("Channel file transfer requires fetch");
    }
    return implementation;
  }

  /** Download one inbound file by opaque handle. */
  async fetchFile(
    handle: string,
  ): Promise<{ bytes: Uint8Array; mimeType?: string }> {
    const response = await this.fetchImpl()(
      `${this.config.baseUrl}/api/channels/files/${encodeURIComponent(handle)}`,
      {
        method: "GET",
        headers: { authorization: `Bearer ${this.config.apiKey}` },
      },
    );
    if (!response.ok) {
      throw new Error(`intelligence file ${handle} -> ${response.status}`);
    }
    const declaredLength = Number(response.headers.get("content-length") ?? "");
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_INBOUND_FILE_BYTES
    ) {
      throw new Error(
        `intelligence file ${handle} too large: ${declaredLength} bytes > ${MAX_INBOUND_FILE_BYTES} cap`,
      );
    }
    const bytes = await readCapped(response, MAX_INBOUND_FILE_BYTES, handle);
    const mimeType = response.headers.get("content-type") ?? undefined;
    return { bytes, ...(mimeType ? { mimeType } : {}) };
  }

  /** Upload one outbound file under the active delivery lease. */
  async uploadFile(
    deliveryId: string,
    args: {
      bytes: Uint8Array;
      filename: string;
      title?: string;
      altText?: string;
    },
  ): Promise<{ handle: string }> {
    const query = new URLSearchParams({ filename: args.filename });
    if (args.title) query.set("title", args.title);
    if (args.altText) query.set("altText", args.altText);
    const response = await this.fetchImpl()(
      `${this.config.baseUrl}/api/channels/deliveries/${encodeURIComponent(deliveryId)}/files?${query.toString()}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          "content-type": "application/octet-stream",
        },
        body: args.bytes as unknown as string,
      },
    );
    if (!response.ok) {
      throw new Error(`intelligence file upload -> ${response.status}`);
    }
    const body = (await response.json()) as { handle?: string };
    if (!body.handle) {
      throw new Error("intelligence file upload: response missing handle");
    }
    return { handle: body.handle };
  }
}
