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
      kind: "slack.message.create" | "slack.message.replace";
      text: string;
      blocks?: ReadonlyArray<Readonly<Record<string, unknown>>>;
    })
  | (ProviderEffectBase & {
      kind: "slack.message.delete";
    })
  | (ProviderEffectBase & {
      kind: "teams.message.create" | "teams.message.replace";
      text: string;
      cards?: ReadonlyArray<Readonly<Record<string, unknown>>>;
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
  "slack.message.create",
  "slack.message.replace",
  "slack.message.delete",
  "teams.message.create",
  "teams.message.replace",
  "slack.file.create",
  "slack.image.create",
  "teams.image.create",
]);

const SHA_256_PATTERN = /^[a-f0-9]{64}$/;

/** Return the UTF-8 JSON size of one provider effect. */
export function providerEffectByteLength(effect: unknown): number {
  return new TextEncoder().encode(JSON.stringify(effect)).byteLength;
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
    !effect.effectId.startsWith("eff_") ||
    !Number.isInteger(effect.seq) ||
    (effect.seq as number) < 0 ||
    typeof effect.responseId !== "string" ||
    !effect.responseId.startsWith("response_") ||
    typeof effect.payloadDigest !== "string" ||
    !SHA_256_PATTERN.test(effect.payloadDigest)
  ) {
    throw new TypeError("provider effect metadata is invalid");
  }
  if (providerEffectByteLength(effect) > PROVIDER_EFFECT_MAX_BYTES) {
    throw new RangeError("provider effect exceeds 64 KiB");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
