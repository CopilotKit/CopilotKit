import { createHash } from "node:crypto";

/** Stable protocol spoken by one Gateway-owned Channel delivery session. */
export const CHANNEL_SESSION_PROTOCOL = "channel_session_v1" as const;

/** Maximum encoded size of one provider effect. */
export const PROVIDER_EFFECT_MAX_BYTES = 64 * 1024;

type ProviderEffectBase = {
  effectId: string;
  seq: number;
  responseId: string;
  payloadDigest: string;
};

export type ChannelProviderEffect =
  | (ProviderEffectBase & {
      kind: "slack.stream.start";
      initialText?: string;
    })
  | (ProviderEffectBase & {
      kind: "slack.stream.append";
      delta: string;
      beforeTextDigest: string;
      afterTextDigest: string;
    })
  | (ProviderEffectBase & {
      kind: "slack.stream.task";
      taskId: string;
      title: string;
      status: "pending" | "in_progress" | "complete" | "failed";
    })
  | (ProviderEffectBase & {
      kind: "slack.stream.stop";
      finalTextDigest: string;
    })
  | (ProviderEffectBase & {
      kind: "slack.status";
      status: string;
    })
  | (ProviderEffectBase & {
      kind: "slack.message.create";
      text: string;
      blocks?: ReadonlyArray<Readonly<Record<string, unknown>>>;
    })
  | (ProviderEffectBase & {
      kind: "slack.message.replace";
      text: string;
      blocks?: ReadonlyArray<Readonly<Record<string, unknown>>>;
      providerReference?: string;
    })
  | (ProviderEffectBase & {
      kind: "slack.message.delete";
      providerReference?: string;
    })
  | (ProviderEffectBase & {
      kind: "teams.message.create";
      text: string;
      cards?: ReadonlyArray<Readonly<Record<string, unknown>>>;
    })
  | (ProviderEffectBase & {
      kind: "teams.message.replace";
      text: string;
      cards?: ReadonlyArray<Readonly<Record<string, unknown>>>;
      providerReference?: string;
    })
  | (ProviderEffectBase & {
      kind: "teams.typing";
    })
  | (ProviderEffectBase & {
      kind: "slack.file.create";
      fileHandle: string;
      title?: string;
      altText?: string;
    })
  | (ProviderEffectBase & {
      kind: "slack.image.create" | "teams.image.create";
      fileHandle: string;
      altText: string;
    });

const TRUSTED_FIELD_NAMES = new Set([
  "channel",
  "channelId",
  "credentials",
  "destination",
  "endpoint",
  "httpMethod",
  "serviceUrl",
  "tenant",
  "tenantId",
  "token",
  "workspace",
  "workspaceId",
]);

const PROVIDER_EFFECT_KINDS = new Set<ChannelProviderEffect["kind"]>([
  "slack.stream.start",
  "slack.stream.append",
  "slack.stream.task",
  "slack.stream.stop",
  "slack.status",
  "slack.message.create",
  "slack.message.replace",
  "slack.message.delete",
  "teams.message.create",
  "teams.message.replace",
  "teams.typing",
  "slack.file.create",
  "slack.image.create",
  "teams.image.create",
]);

const SHA_256_PATTERN = /^[a-f0-9]{64}$/;
const PROVIDER_REFERENCE_PATTERN = /^pref_v1_[A-Za-z0-9_-]+$/;
const EFFECT_ID_PATTERN = /^eff_[A-Za-z0-9_-]+$/;
const RESPONSE_ID_PATTERN = /^response_[A-Za-z0-9_-]+$/;
const BASE_EFFECT_FIELDS = [
  "kind",
  "effectId",
  "seq",
  "responseId",
  "payloadDigest",
] as const;

/** Assert that a message reference is an opaque Gateway-minted capability. */
export function assertProviderReference(
  value: unknown,
): asserts value is string {
  if (typeof value !== "string" || !PROVIDER_REFERENCE_PATTERN.test(value)) {
    throw new TypeError(
      "provider reference must be an opaque pref_v1 capability",
    );
  }
}

/** Return the UTF-8 JSON size of one provider effect. */
export function providerEffectByteLength(effect: unknown): number {
  return new TextEncoder().encode(JSON.stringify(effect)).byteLength;
}

/** Hash one effect without its `payloadDigest` using stable JSON key order. */
export function providerEffectPayloadDigest(unsignedEffect: unknown): string {
  const encoded = JSON.stringify(canonicalizeJson(unsignedEffect));
  if (encoded === undefined) {
    throw new TypeError("provider effect payload is not JSON encodable");
  }
  return createHash("sha256").update(encoded).digest("hex");
}

/** Assert that the full Gateway effect envelope fits the protocol byte limit. */
export function assertProviderEffectEnvelopeSize(envelope: unknown): void {
  if (providerEffectByteLength(envelope) > PROVIDER_EFFECT_MAX_BYTES) {
    throw new RangeError("provider effect envelope exceeds 64 KiB");
  }
}

/** Assert that an SDK effect is bounded and contains no trusted provider data. */
export function assertProviderEffect(
  effect: unknown,
): asserts effect is ChannelProviderEffect {
  if (!isRecord(effect)) {
    throw new TypeError("provider effect must be an object");
  }
  for (const field of Object.keys(effect)) {
    if (TRUSTED_FIELD_NAMES.has(field)) {
      throw new TypeError("provider effect contains a trusted field");
    }
  }
  if (
    typeof effect.kind !== "string" ||
    !PROVIDER_EFFECT_KINDS.has(effect.kind as ChannelProviderEffect["kind"])
  ) {
    throw new TypeError("provider effect kind is not supported");
  }
  if (
    typeof effect.effectId !== "string" ||
    !EFFECT_ID_PATTERN.test(effect.effectId) ||
    !Number.isInteger(effect.seq) ||
    (effect.seq as number) < 0 ||
    typeof effect.responseId !== "string" ||
    !RESPONSE_ID_PATTERN.test(effect.responseId) ||
    typeof effect.payloadDigest !== "string" ||
    !SHA_256_PATTERN.test(effect.payloadDigest)
  ) {
    throw new TypeError("provider effect metadata is invalid");
  }
  if ("providerReference" in effect) {
    if (
      effect.kind !== "slack.message.replace" &&
      effect.kind !== "slack.message.delete" &&
      effect.kind !== "teams.message.replace"
    ) {
      throw new TypeError(
        "provider reference is not supported for this effect kind",
      );
    }
    assertProviderReference(effect.providerReference);
  }
  if (!hasValidProviderPayload(effect)) {
    throw new TypeError("provider effect payload is invalid");
  }
  if (providerEffectByteLength(effect) > PROVIDER_EFFECT_MAX_BYTES) {
    throw new RangeError("provider effect exceeds 64 KiB");
  }
  const { payloadDigest, ...unsignedEffect } = effect;
  if (providerEffectPayloadDigest(unsignedEffect) !== payloadDigest) {
    throw new TypeError("provider effect payload digest is invalid");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasValidProviderPayload(effect: Record<string, unknown>): boolean {
  switch (effect.kind) {
    case "slack.stream.start":
      return (
        hasOnlyFields(effect, ["initialText"]) &&
        optionalString(effect.initialText)
      );
    case "slack.stream.append":
      return (
        hasOnlyFields(effect, [
          "delta",
          "beforeTextDigest",
          "afterTextDigest",
        ]) &&
        typeof effect.delta === "string" &&
        sha256(effect.beforeTextDigest) &&
        sha256(effect.afterTextDigest)
      );
    case "slack.stream.task":
      return (
        hasOnlyFields(effect, ["taskId", "title", "status"]) &&
        nonEmptyString(effect.taskId) &&
        typeof effect.title === "string" &&
        (effect.status === "pending" ||
          effect.status === "in_progress" ||
          effect.status === "complete" ||
          effect.status === "failed")
      );
    case "slack.stream.stop":
      return (
        hasOnlyFields(effect, ["finalTextDigest"]) &&
        sha256(effect.finalTextDigest)
      );
    case "slack.status":
      return (
        hasOnlyFields(effect, ["status"]) && typeof effect.status === "string"
      );
    case "slack.message.create":
      return (
        hasOnlyFields(effect, ["text", "blocks"]) &&
        typeof effect.text === "string" &&
        optionalRecordArray(effect.blocks)
      );
    case "slack.message.replace":
      return (
        hasOnlyFields(effect, ["text", "blocks", "providerReference"]) &&
        typeof effect.text === "string" &&
        optionalRecordArray(effect.blocks)
      );
    case "slack.message.delete":
      return hasOnlyFields(effect, ["providerReference"]);
    case "teams.message.create":
      return (
        hasOnlyFields(effect, ["text", "cards"]) &&
        typeof effect.text === "string" &&
        optionalRecordArray(effect.cards)
      );
    case "teams.message.replace":
      return (
        hasOnlyFields(effect, ["text", "cards", "providerReference"]) &&
        typeof effect.text === "string" &&
        optionalRecordArray(effect.cards)
      );
    case "teams.typing":
      return hasOnlyFields(effect, []);
    case "slack.file.create":
      return (
        hasOnlyFields(effect, ["fileHandle", "title", "altText"]) &&
        nonEmptyString(effect.fileHandle) &&
        optionalString(effect.title) &&
        optionalString(effect.altText)
      );
    case "slack.image.create":
    case "teams.image.create":
      return (
        hasOnlyFields(effect, ["fileHandle", "altText"]) &&
        nonEmptyString(effect.fileHandle) &&
        typeof effect.altText === "string"
      );
    default:
      return false;
  }
}

function hasOnlyFields(
  effect: Record<string, unknown>,
  payloadFields: readonly string[],
): boolean {
  const allowed = new Set<string>([...BASE_EFFECT_FIELDS, ...payloadFields]);
  return Object.keys(effect).every((field) => allowed.has(field));
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

function sha256(value: unknown): boolean {
  return typeof value === "string" && SHA_256_PATTERN.test(value);
}

function optionalRecordArray(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every((item) => isRecord(item)))
  );
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) =>
      item === undefined ? null : canonicalizeJson(item),
    );
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, canonicalizeJson(value[key])]),
  );
}
