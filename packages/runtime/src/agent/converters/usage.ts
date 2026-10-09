import type { BaseEvent } from "@ag-ui/client";

export interface AgentRunUsage {
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
}

export interface AgentRunFinishedDetails {
  metadata?: BaseEvent["metadata"];
  usage?: AgentRunUsage[];
}

export const tokenCountKeys = [
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "reasoningTokens",
  "cachedInputTokens",
] as const;

/** Returns a token count only when it is a safe, non-negative integer. */
export function getTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

/** Adds usage entries to a run, grouping and summing matching identities. */
export function aggregateRunUsage(
  details: AgentRunFinishedDetails,
  entries: AgentRunUsage[],
): void {
  for (const entry of entries) {
    const hasCount = tokenCountKeys.some((key) => entry[key] !== undefined);
    if (!hasCount) continue;

    details.usage ??= [];
    const existing = details.usage.find(
      (candidate) =>
        candidate.provider === entry.provider &&
        candidate.model === entry.model,
    );

    if (!existing) {
      details.usage.push({ ...entry });
      continue;
    }

    for (const key of tokenCountKeys) {
      const value = entry[key];
      if (value === undefined) continue;

      const sum = (existing[key] ?? 0) + value;
      if (Number.isSafeInteger(sum)) {
        existing[key] = sum;
      }
    }
  }
}

/** Keeps terminal metadata and the last supplied string reason; accumulates usage. */
export function collectStandardRunFinishedDetails(
  event: Record<string, unknown>,
  details: AgentRunFinishedDetails,
  fallbackIdentity: { provider?: string; model?: string } = {},
): void {
  const previousFinishReason = details.metadata?.finishReason;
  if (isRecord(event.metadata)) {
    details.metadata = { ...event.metadata };
  } else {
    delete details.metadata;
  }
  // Match the previous top-level finishReason behavior: only a new string
  // replaces the reason, while other metadata comes from the latest event.
  if (
    typeof details.metadata?.finishReason !== "string" &&
    typeof previousFinishReason === "string"
  ) {
    details.metadata = {
      ...details.metadata,
      finishReason: previousFinishReason,
    };
  }

  if (!Array.isArray(event.usage)) return;

  aggregateRunUsage(
    details,
    event.usage.flatMap((entry) => {
      if (!isRecord(entry)) return [];

      const normalized: AgentRunUsage = {
        provider:
          getNonEmptyString(entry.provider) ?? fallbackIdentity.provider,
        model: getNonEmptyString(entry.model) ?? fallbackIdentity.model,
      };
      for (const key of tokenCountKeys) {
        normalized[key] = getTokenCount(entry[key]);
      }
      return [normalized];
    }),
  );
}

/** Narrows an unknown value to a string-keyed object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Returns a non-empty string identity without changing its value. */
export function getNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
