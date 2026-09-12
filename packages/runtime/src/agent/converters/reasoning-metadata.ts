import type { Message } from "@ag-ui/client";
import type { ProviderMetadata } from "ai";

const AI_SDK_PROVIDER_METADATA_KEY = "aiSdkProviderMetadata";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseProviderMetadata(value: unknown): ProviderMetadata | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new Error("AI SDK provider metadata must be an object");
  }

  for (const [provider, metadata] of Object.entries(value)) {
    if (!isRecord(metadata)) {
      throw new Error(
        `AI SDK provider metadata for "${provider}" must be an object`,
      );
    }
  }

  return value as ProviderMetadata;
}

export function mergeAISDKProviderMetadata(
  current: ProviderMetadata | undefined,
  incoming: unknown,
): ProviderMetadata | undefined {
  const parsed = parseProviderMetadata(incoming);
  if (!parsed) return current;

  const merged: ProviderMetadata = { ...current };
  for (const [provider, metadata] of Object.entries(parsed)) {
    merged[provider] = {
      ...current?.[provider],
      ...metadata,
    };
  }
  return merged;
}

export function reasoningEventMetadata(
  providerMetadata: ProviderMetadata | undefined,
): Record<string, unknown> | undefined {
  return providerMetadata
    ? { [AI_SDK_PROVIDER_METADATA_KEY]: providerMetadata }
    : undefined;
}

export function reasoningMessageProviderOptions(
  message: Message,
): ProviderMetadata | undefined {
  return parseProviderMetadata(
    message.metadata?.[AI_SDK_PROVIDER_METADATA_KEY],
  );
}
