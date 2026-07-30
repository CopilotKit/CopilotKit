import { createHash } from "node:crypto";

/** Hard-cut protocol for the dedicated `/channels` socket. */
export const CHANNEL_DELIVERY_PROTOCOL = "channel_delivery_v1" as const;

/** Fixed one-use delivery join-token lifetime. */
export const CHANNEL_DELIVERY_JOIN_TOKEN_TTL_SECONDS = 60;

/** Fixed Redis delivery-owner lifetime. */
export const CHANNEL_DELIVERY_OWNER_TTL_SECONDS = 60 * 60;

/** Maximum encoded size of one ordered packet. */
export const DELIVERY_PACKET_MAX_BYTES = 64 * 1024;

const SHA_256_PATTERN = /^[a-f0-9]{64}$/;
const PROVIDER_REFERENCE_PATTERN = /^pref_v1_[A-Za-z0-9_-]{8,4088}$/;
const EFFECT_ID_PATTERN = /^eff_[A-Za-z0-9_-]{2,128}$/;
const RESPONSE_ID_PATTERN = /^response_[A-Za-z0-9_-]{1,123}$/;
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
      beforeTextDigest: string;
      afterTextDigest: string;
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
      finalTextDigest: string;
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
      kind: "slack.message.delete";
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
      kind: "slack.file.create";
      fileHandle: string;
      title?: string;
      altText?: string;
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

export type ChannelDeliveryPayload =
  | ChannelProviderPayload
  | ChannelTerminalPayload;

export interface ChannelDeliveryPacket {
  protocol: typeof CHANNEL_DELIVERY_PROTOCOL;
  deliveryId: string;
  runtimeInstanceId: string;
  ownerGeneration: number;
  seq: number;
  effectId: string;
  responseId: string;
  payloadDigest: string;
  payload: ChannelDeliveryPayload;
}

export interface ChannelDeliveryPacketAck {
  deliveryId: string;
  seq: number;
  effectId: string;
  responseId: string;
  payloadDigest: string;
  phase: "applied";
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

/** Hash the exact provider-ready payload with stable object key order. */
export function deliveryPayloadDigest(payload: unknown): string {
  const encoded = JSON.stringify(canonicalizeJson(payload));
  if (encoded === undefined) {
    throw new TypeError("delivery payload is not JSON encodable");
  }
  return createHash("sha256").update(encoded).digest("hex");
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
      "effectId",
      "responseId",
      "payloadDigest",
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
    typeof value.effectId !== "string" ||
    !EFFECT_ID_PATTERN.test(value.effectId) ||
    typeof value.responseId !== "string" ||
    !RESPONSE_ID_PATTERN.test(value.responseId) ||
    typeof value.payloadDigest !== "string" ||
    !SHA_256_PATTERN.test(value.payloadDigest)
  ) {
    throw new TypeError("delivery packet fields are invalid");
  }
  if (!isDeliveryPayload(value.payload)) {
    throw new TypeError("delivery payload is invalid");
  }
  if (deliveryPayloadDigest(value.payload) !== value.payloadDigest) {
    throw new TypeError("delivery payload digest is invalid");
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
        hasExactFields(value, [
          "kind",
          "providerReference",
          "delta",
          "beforeTextDigest",
          "afterTextDigest",
        ]) &&
        validReference(value.providerReference) &&
        boundedString(value.delta, 1, 40_000) &&
        sha256(value.beforeTextDigest) &&
        sha256(value.afterTextDigest)
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
        hasExactFields(value, [
          "kind",
          "providerReference",
          "finalTextDigest",
        ]) &&
        validReference(value.providerReference) &&
        sha256(value.finalTextDigest)
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
    default:
      return false;
  }
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalizeJson(value[key])]),
  );
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

function optionalRecordArray(value: unknown, max: number): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length <= max &&
      value.every((entry) => isRecord(entry)))
  );
}

function sha256(value: unknown): boolean {
  return typeof value === "string" && SHA_256_PATTERN.test(value);
}

function validReference(value: unknown): boolean {
  return typeof value === "string" && PROVIDER_REFERENCE_PATTERN.test(value);
}
