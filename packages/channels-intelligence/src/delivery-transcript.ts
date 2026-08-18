import {
  isProviderMessageId,
  isProviderReference,
} from "./delivery-contracts.js";

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
  messageRef: { id: string };
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

const hasExactFields = (
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean => {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((field) => Object.hasOwn(value, field)) &&
    Object.keys(value).every((field) => allowed.has(field))
  );
};

const isTeamsId = (value: unknown): value is string =>
  typeof value === "string" &&
  value.trim().length >= 1 &&
  value.trim().length <= 512;

const isNullableBoundedString = (
  value: unknown,
  maximum: number,
): value is string | null =>
  value === null || (typeof value === "string" && value.length <= maximum);

const isIsoDateTime = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
    value,
  ) &&
  Number.isFinite(Date.parse(value));

const isTranscriptActor = (value: unknown): value is ChannelTranscriptActor =>
  isRecord(value) &&
  hasExactFields(value, ["id", "kind", "displayName", "handle"]) &&
  isTeamsId(value.id) &&
  ["human", "bot", "app", "system"].includes(String(value.kind)) &&
  isNullableBoundedString(value.displayName, 256) &&
  isNullableBoundedString(value.handle, 256);

const isTranscriptFile = (value: unknown): value is ChannelTranscriptFile =>
  isRecord(value) &&
  hasExactFields(
    value,
    ["providerFileId", "name", "mimeType", "byteSize", "availability"],
    ["handle"],
  ) &&
  isTeamsId(value.providerFileId) &&
  isNullableBoundedString(value.name, 512) &&
  isNullableBoundedString(value.mimeType, 256) &&
  (value.byteSize === null ||
    (typeof value.byteSize === "number" &&
      Number.isSafeInteger(value.byteSize) &&
      value.byteSize >= 0)) &&
  ["managed", "provider_only", "unavailable"].includes(
    String(value.availability),
  ) &&
  (value.handle === undefined ||
    (typeof value.handle === "string" &&
      value.handle.length >= 1 &&
      value.handle.length <= 200));

const isTranscriptMessage = (
  value: unknown,
): value is ChannelTranscriptMessage =>
  isRecord(value) &&
  hasExactFields(value, [
    "logicalMessageId",
    "revisionId",
    "occurredAt",
    "role",
    "actor",
    "text",
    "messageRef",
    "deleted",
    "currentTrigger",
    "files",
  ]) &&
  isProviderMessageId(value.logicalMessageId) &&
  isProviderMessageId(value.revisionId) &&
  isIsoDateTime(value.occurredAt) &&
  (value.role === "participant" || value.role === "assistant") &&
  isTranscriptActor(value.actor) &&
  typeof value.text === "string" &&
  isRecord(value.messageRef) &&
  hasExactFields(value.messageRef, ["id"]) &&
  isProviderReference(value.messageRef.id) &&
  typeof value.deleted === "boolean" &&
  typeof value.currentTrigger === "boolean" &&
  Array.isArray(value.files) &&
  value.files.length <= 100 &&
  value.files.every(isTranscriptFile);

const parseTranscript = (value: unknown): ChannelDeliveryTranscript | null => {
  if (
    !isRecord(value) ||
    !hasExactFields(value, ["messages", "truncation"]) ||
    !Array.isArray(value.messages) ||
    value.messages.length > 100 ||
    !value.messages.every(isTranscriptMessage) ||
    !isRecord(value.truncation) ||
    !hasExactFields(value.truncation, [
      "messageLimit",
      "byteLimit",
      "omittedMessageCount",
    ]) ||
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
