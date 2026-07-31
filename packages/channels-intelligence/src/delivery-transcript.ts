export type ChannelTranscriptActorKind = "human" | "bot" | "app" | "system";

export interface ChannelTranscriptActor {
  id: string;
  kind: ChannelTranscriptActorKind;
  displayName: string | null;
  handle: string | null;
}

export interface ChannelTranscriptFile {
  providerFileId: string;
  name: string | null;
  mimeType: string | null;
  byteSize: number | null;
  availability: "managed" | "provider_only" | "unavailable";
  handle?: string;
}

export interface ChannelTranscriptMessage {
  logicalMessageId: string;
  revisionId: string;
  occurredAt: string;
  role: "participant" | "assistant";
  actor: ChannelTranscriptActor;
  text: string;
  deleted: boolean;
  currentTrigger: boolean;
  files: ChannelTranscriptFile[];
}

export interface ChannelDeliveryTranscript {
  messages: ChannelTranscriptMessage[];
  truncation: {
    messageLimit: boolean;
    byteLimit: boolean;
    omittedMessageCount: number;
  };
}

export interface ChannelDeliveryTranscriptClientConfig {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
}

/** Stable transcript failure surfaced to managed Channel handlers. */
export class ChannelDeliveryTranscriptError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly attempts: number,
  ) {
    super(`Channel transcript failed with ${code}`);
    this.name = "ChannelDeliveryTranscriptError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNullableString = (value: unknown): value is string | null =>
  typeof value === "string" || value === null;

const isTranscriptActor = (value: unknown): value is ChannelTranscriptActor =>
  isRecord(value) &&
  typeof value.id === "string" &&
  ["human", "bot", "app", "system"].includes(String(value.kind)) &&
  isNullableString(value.displayName) &&
  isNullableString(value.handle);

const isTranscriptFile = (value: unknown): value is ChannelTranscriptFile =>
  isRecord(value) &&
  typeof value.providerFileId === "string" &&
  isNullableString(value.name) &&
  isNullableString(value.mimeType) &&
  (value.byteSize === null ||
    (typeof value.byteSize === "number" &&
      Number.isSafeInteger(value.byteSize) &&
      value.byteSize >= 0)) &&
  ["managed", "provider_only", "unavailable"].includes(
    String(value.availability),
  ) &&
  (value.handle === undefined || typeof value.handle === "string");

const isTranscriptMessage = (
  value: unknown,
): value is ChannelTranscriptMessage =>
  isRecord(value) &&
  typeof value.logicalMessageId === "string" &&
  typeof value.revisionId === "string" &&
  typeof value.occurredAt === "string" &&
  Number.isFinite(Date.parse(value.occurredAt)) &&
  (value.role === "participant" || value.role === "assistant") &&
  isTranscriptActor(value.actor) &&
  typeof value.text === "string" &&
  typeof value.deleted === "boolean" &&
  typeof value.currentTrigger === "boolean" &&
  Array.isArray(value.files) &&
  value.files.every(isTranscriptFile);

const parseTranscript = (value: unknown): ChannelDeliveryTranscript | null => {
  if (
    !isRecord(value) ||
    !Array.isArray(value.messages) ||
    value.messages.length > 100 ||
    !value.messages.every(isTranscriptMessage) ||
    !isRecord(value.truncation) ||
    typeof value.truncation.messageLimit !== "boolean" ||
    typeof value.truncation.byteLimit !== "boolean" ||
    typeof value.truncation.omittedMessageCount !== "number" ||
    !Number.isSafeInteger(value.truncation.omittedMessageCount) ||
    value.truncation.omittedMessageCount < 0
  ) {
    return null;
  }
  return value as unknown as ChannelDeliveryTranscript;
};

const parseError = (
  value: unknown,
  status: number,
): { code: string; retryable: boolean } => {
  const root = isRecord(value) ? value : {};
  const nested = isRecord(root.error) ? root.error : root;
  const code =
    typeof nested.code === "string"
      ? nested.code
      : "CHANNEL_TRANSCRIPT_RETRYABLE";
  const retryable =
    typeof nested.retryable === "boolean"
      ? nested.retryable
      : status === 429 || status >= 500;
  return { code, retryable };
};

/** Runtime-authenticated App API transcript client with exactly three attempts. */
export class ChannelDeliveryTranscriptClient {
  constructor(private readonly config: ChannelDeliveryTranscriptClientConfig) {}

  async fetchTranscript(
    deliveryId: string,
  ): Promise<ChannelDeliveryTranscript> {
    const fetchImpl = this.config.fetch ?? globalThis.fetch;
    if (!fetchImpl) {
      throw new ChannelDeliveryTranscriptError(
        "CHANNEL_TRANSCRIPT_FETCH_UNAVAILABLE",
        false,
        0,
      );
    }
    const baseUrl = this.config.baseUrl.replace(/\/+$/u, "");

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      let response: Response;
      try {
        response = await fetchImpl(
          `${baseUrl}/api/channels/deliveries/${encodeURIComponent(deliveryId)}/transcript`,
          {
            method: "GET",
            headers: { authorization: `Bearer ${this.config.apiKey}` },
          },
        );
      } catch {
        if (attempt < 3) continue;
        throw new ChannelDeliveryTranscriptError(
          "CHANNEL_TRANSCRIPT_RETRYABLE",
          true,
          attempt,
        );
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new ChannelDeliveryTranscriptError(
          "CHANNEL_TRANSCRIPT_RESPONSE_INVALID",
          false,
          attempt,
        );
      }
      if (response.ok) {
        const transcript = parseTranscript(body);
        if (!transcript) {
          throw new ChannelDeliveryTranscriptError(
            "CHANNEL_TRANSCRIPT_RESPONSE_INVALID",
            false,
            attempt,
          );
        }
        return transcript;
      }

      const error = parseError(body, response.status);
      if (!error.retryable || attempt === 3) {
        throw new ChannelDeliveryTranscriptError(
          error.code,
          error.retryable,
          attempt,
        );
      }
    }

    throw new ChannelDeliveryTranscriptError(
      "CHANNEL_TRANSCRIPT_RETRYABLE",
      true,
      3,
    );
  }
}
