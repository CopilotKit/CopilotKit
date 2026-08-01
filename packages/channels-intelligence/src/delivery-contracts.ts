/** Hard-cut protocol for the dedicated `/channels` socket. */
export const CHANNEL_DELIVERY_PROTOCOL = "channel_delivery_v1" as const;

/** Fixed one-use delivery join-token lifetime. */
export const CHANNEL_DELIVERY_JOIN_TOKEN_TTL_SECONDS = 60;

/** Fixed Redis delivery-owner lifetime. */
export const CHANNEL_DELIVERY_OWNER_TTL_SECONDS = 60 * 60;

/** Maximum encoded size of one ordered packet. */
export const DELIVERY_PACKET_MAX_BYTES = 64 * 1024;

const PROVIDER_REFERENCE_PATTERN = /^pref_v1_[A-Za-z0-9_-]{8,4088}$/;
const PACKET_ID_PATTERN = /^pkt_[A-Za-z0-9_-]{2,128}$/;
const DELIVERY_ID_PATTERN = /^dlv_[A-Za-z0-9_-]{8,128}$/;
const RUNTIME_ID_PATTERN = /^rti_[A-Za-z0-9_-]{4,96}$/;

export type ChannelProviderPayload =
  | {
      kind: "slack.stream.start";
      initialText?: string;
    }
  | {
      kind: "slack.stream.append";
      providerReference: string;
      delta: string;
    }
  | {
      kind: "slack.stream.task";
      providerReference: string;
      taskId: string;
      title: string;
      status: "pending" | "in_progress" | "complete" | "failed";
    }
  | {
      kind: "slack.stream.stop";
      providerReference: string;
    }
  | {
      kind: "slack.thread.status";
      status: string;
      loadingMessages?: readonly string[];
    }
  | {
      kind: "slack.message.create";
      text: string;
      blocks?: ReadonlyArray<Readonly<Record<string, unknown>>>;
    }
  | {
      kind: "slack.message.replace";
      providerReference: string;
      text: string;
      blocks?: ReadonlyArray<Readonly<Record<string, unknown>>>;
    }
  | {
      kind: "slack.message.delete" | "teams.message.delete";
      providerReference: string;
    }
  | {
      kind: "teams.message.create";
      text: string;
      cards?: ReadonlyArray<Readonly<Record<string, unknown>>>;
    }
  | {
      kind: "teams.message.replace";
      providerReference: string;
      text: string;
      cards?: ReadonlyArray<Readonly<Record<string, unknown>>>;
    }
  | {
      kind: "teams.message.finalize";
      providerReference: string;
      text: string;
      cards?: ReadonlyArray<Readonly<Record<string, unknown>>>;
    }
  | { kind: "teams.typing" }
  | {
      kind:
        | "slack.reaction.add"
        | "slack.reaction.remove"
        | "teams.reaction.add"
        | "teams.reaction.remove";
      providerReference: string;
      reaction: string;
    }
  | {
      kind: "slack.file.create";
      fileHandle: string;
      title?: string;
      altText?: string;
    }
  | {
      kind: "teams.file.create";
      fileHandle: string;
      filename: string;
      title?: string;
      altText?: string;
    }
  | {
      kind: "teams.file.consent.complete";
      fileHandle: string;
    }
  | {
      kind: "slack.image.create" | "teams.image.create";
      fileHandle: string;
      altText: string;
    };

export type ChannelTerminalPayload = {
  kind: "channel.delivery.terminal";
  status: "complete" | "failed_before_output" | "failed" | "uncertain";
  code:
    | "provider_delivery_complete"
    | "provider_call_failed"
    | "provider_call_timed_out"
    | "uncertain_owner_lost"
    | "runtime_handler_failed";
};

export type ChannelCommitPayload = {
  kind: "channel.delivery.commit";
};

export type ChannelDeliveryPayload =
  | ChannelProviderPayload
  | ChannelCommitPayload
  | ChannelTerminalPayload;

export interface ChannelDeliveryPacket {
  protocol: typeof CHANNEL_DELIVERY_PROTOCOL;
  deliveryId: string;
  runtimeInstanceId: string;
  ownerGeneration: number;
  seq: number;
  packetId: string;
  payload: ChannelDeliveryPayload;
}

export interface ChannelDeliveryPacketAck {
  deliveryId: string;
  seq: number;
  packetId: string;
  phase: "applied" | "retry_wait" | "failed" | "uncertain";
  retryAt?: string;
  result: Record<string, unknown>;
}

/** Assert that a provider reference is an opaque Gateway capability. */
export function assertProviderReference(
  value: unknown,
): asserts value is string {
  if (typeof value !== "string" || !PROVIDER_REFERENCE_PATTERN.test(value)) {
    throw new TypeError(
      "provider reference must be an opaque pref_v1 capability",
    );
  }
}

/** Return the UTF-8 JSON size of a value. */
export function deliveryPacketByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/** Validate one exact, bounded, destination-free delivery packet. */
export function assertDeliveryPacket(
  value: unknown,
): asserts value is ChannelDeliveryPacket {
  if (!isRecord(value)) {
    throw new TypeError("delivery packet must be an object");
  }
  if (
    !hasExactFields(value, [
      "protocol",
      "deliveryId",
      "runtimeInstanceId",
      "ownerGeneration",
      "seq",
      "packetId",
      "payload",
    ]) ||
    value.protocol !== CHANNEL_DELIVERY_PROTOCOL ||
    typeof value.deliveryId !== "string" ||
    !DELIVERY_ID_PATTERN.test(value.deliveryId) ||
    typeof value.runtimeInstanceId !== "string" ||
    !RUNTIME_ID_PATTERN.test(value.runtimeInstanceId) ||
    !Number.isInteger(value.ownerGeneration) ||
    (value.ownerGeneration as number) < 1 ||
    !Number.isInteger(value.seq) ||
    (value.seq as number) < 0 ||
    typeof value.packetId !== "string" ||
    !PACKET_ID_PATTERN.test(value.packetId)
  ) {
    throw new TypeError("delivery packet fields are invalid");
  }
  if (!isDeliveryPayload(value.payload)) {
    throw new TypeError("delivery payload is invalid");
  }
  if (deliveryPacketByteLength(value) > DELIVERY_PACKET_MAX_BYTES) {
    throw new RangeError("delivery packet exceeds 64 KiB");
  }
}

function isDeliveryPayload(value: unknown): value is ChannelDeliveryPayload {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "slack.stream.start":
      return (
        hasExactFields(value, ["kind", "initialText"], ["initialText"]) &&
        optionalBoundedString(value.initialText, 40_000)
      );
    case "slack.stream.append":
      return (
        hasExactFields(value, ["kind", "providerReference", "delta"]) &&
        validReference(value.providerReference) &&
        boundedString(value.delta, 1, 40_000)
      );
    case "slack.stream.task":
      return (
        hasExactFields(value, [
          "kind",
          "providerReference",
          "taskId",
          "title",
          "status",
        ]) &&
        validReference(value.providerReference) &&
        boundedString(value.taskId, 1, 128) &&
        boundedString(value.title, 1, 512) &&
        ["pending", "in_progress", "complete", "failed"].includes(
          String(value.status),
        )
      );
    case "slack.stream.stop":
      return (
        hasExactFields(value, ["kind", "providerReference"]) &&
        validReference(value.providerReference)
      );
    case "slack.thread.status":
      return (
        hasExactFields(
          value,
          ["kind", "status", "loadingMessages"],
          ["loadingMessages"],
        ) &&
        boundedString(value.status, 0, 512) &&
        optionalBoundedStringArray(value.loadingMessages, 10, 512)
      );
    case "slack.message.create":
      return (
        hasExactFields(value, ["kind", "text", "blocks"], ["blocks"]) &&
        boundedString(value.text, 0, 40_000) &&
        optionalRecordArray(value.blocks, 100)
      );
    case "slack.message.replace":
      return (
        hasExactFields(
          value,
          ["kind", "providerReference", "text", "blocks"],
          ["blocks"],
        ) &&
        validReference(value.providerReference) &&
        boundedString(value.text, 0, 40_000) &&
        optionalRecordArray(value.blocks, 100)
      );
    case "slack.message.delete":
    case "teams.message.delete":
      return (
        hasExactFields(value, ["kind", "providerReference"]) &&
        validReference(value.providerReference)
      );
    case "teams.message.create":
      return (
        hasExactFields(value, ["kind", "text", "cards"], ["cards"]) &&
        boundedString(value.text, 0, 40_000) &&
        optionalRecordArray(value.cards, 25)
      );
    case "teams.message.replace":
    case "teams.message.finalize":
      return (
        hasExactFields(
          value,
          ["kind", "providerReference", "text", "cards"],
          ["cards"],
        ) &&
        validReference(value.providerReference) &&
        boundedString(value.text, 0, 40_000) &&
        optionalRecordArray(value.cards, 25)
      );
    case "teams.typing":
      return hasExactFields(value, ["kind"]);
    case "slack.reaction.add":
    case "slack.reaction.remove":
    case "teams.reaction.add":
    case "teams.reaction.remove":
      return (
        hasExactFields(value, ["kind", "providerReference", "reaction"]) &&
        validReference(value.providerReference) &&
        boundedString(value.reaction, 1, 128)
      );
    case "slack.file.create":
      return (
        hasExactFields(
          value,
          ["kind", "fileHandle", "title", "altText"],
          ["title", "altText"],
        ) &&
        boundedString(value.fileHandle, 1, 128) &&
        optionalBoundedString(value.title, 512) &&
        optionalBoundedString(value.altText, 2_000)
      );
    case "teams.file.create":
      return (
        hasExactFields(
          value,
          ["kind", "fileHandle", "filename", "title", "altText"],
          ["title", "altText"],
        ) &&
        boundedString(value.fileHandle, 1, 128) &&
        boundedString(value.filename, 1, 512) &&
        optionalBoundedString(value.title, 512) &&
        optionalBoundedString(value.altText, 2_000)
      );
    case "teams.file.consent.complete":
      return (
        hasExactFields(value, ["kind", "fileHandle"]) &&
        boundedString(value.fileHandle, 1, 128)
      );
    case "slack.image.create":
    case "teams.image.create":
      return (
        hasExactFields(value, ["kind", "fileHandle", "altText"]) &&
        boundedString(value.fileHandle, 1, 128) &&
        boundedString(value.altText, 1, 2_000)
      );
    case "channel.delivery.terminal":
      return (
        hasExactFields(value, ["kind", "status", "code"]) &&
        ["complete", "failed_before_output", "failed", "uncertain"].includes(
          String(value.status),
        ) &&
        [
          "provider_delivery_complete",
          "provider_call_failed",
          "provider_call_timed_out",
          "uncertain_owner_lost",
          "runtime_handler_failed",
        ].includes(String(value.code))
      );
    case "channel.delivery.commit":
      return hasExactFields(value, ["kind"]);
    default:
      return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set(fields);
  const optionalSet = new Set(optional);
  return (
    Object.keys(value).every((field) => allowed.has(field)) &&
    fields.every((field) => optionalSet.has(field) || field in value)
  );
}

function boundedString(value: unknown, min: number, max: number): boolean {
  return (
    typeof value === "string" && value.length >= min && value.length <= max
  );
}

function optionalBoundedString(value: unknown, max: number): boolean {
  return value === undefined || boundedString(value, 0, max);
}

function optionalBoundedStringArray(
  value: unknown,
  maxItems: number,
  maxLength: number,
): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length <= maxItems &&
      value.every((item) => boundedString(item, 1, maxLength)))
  );
}

function optionalRecordArray(value: unknown, max: number): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length <= max &&
      value.every((entry) => isRecord(entry)))
  );
}

function validReference(value: unknown): boolean {
  return typeof value === "string" && PROVIDER_REFERENCE_PATTERN.test(value);
}
