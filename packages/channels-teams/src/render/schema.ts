import type { JsonObject, JsonValue } from "@copilotkit/channels-ui";

/**
 * The authoring schema is pinned for reproducibility. Runtime validation is
 * self-contained and never fetches this URL; the Microsoft package version is
 * the compile-time source for the public prop vocabulary.
 */
export const TEAMS_SCHEMA_LOCK = {
  url: "https://adaptivecards.microsoft.com/schemas/adaptive-card-2026-01-13.json",
  sha256: "b8aad7c59ee252e619601a27057d44aecffbfc8969962924846c26fc185d1cfc",
  package: "@microsoft/teams.cards@2.0.14",
} as const;

/** The schema URL emitted for Teams-hosted Adaptive Cards. */
export const TEAMS_CARD_SCHEMA_URL =
  "http://adaptivecards.io/schemas/adaptive-card.json";
export const TEAMS_CARD_VERSION = "1.5";
export const TEAMS_CARD_MAX_BYTES = 28 * 1024;

/** JSON payload accepted by the Teams attachment API. */
export interface AdaptiveCardPayload {
  type: "AdaptiveCard";
  $schema: string;
  version: string;
  body: JsonObject[];
  actions?: JsonObject[];
  [key: string]: JsonValue | undefined;
}

/**
 * Validate the safe boundary required by both raw cards and the native JSX
 * serializer. This validator intentionally has no Ajv runtime dependency and
 * catches the class of errors Teams otherwise reports as an opaque send error.
 */
export function assertAdaptiveCardPayload(
  payload: unknown,
): asserts payload is AdaptiveCardPayload {
  assertJsonData(payload, new WeakSet<object>(), "card");
  if (!isRecord(payload) || payload.type !== "AdaptiveCard") {
    throw new Error("Adaptive Card payload must have an AdaptiveCard root.");
  }
  if (!Array.isArray(payload.body)) {
    throw new Error("Adaptive Card payload must provide a body array.");
  }
  if (
    typeof payload.version !== "string" ||
    !isSupportedVersion(payload.version)
  ) {
    throw new Error(
      `Adaptive Card version must be at most ${TEAMS_CARD_VERSION}; received ${String(payload.version)}.`,
    );
  }
  if (containsUnsupportedTeamsFeature(payload)) {
    throw new Error(
      "Adaptive Card payload contains Action.Execute, which is not supported by the Teams-native Channels surface.",
    );
  }
  const bytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  if (bytes > TEAMS_CARD_MAX_BYTES) {
    throw new Error(
      `Adaptive Card payload is ${bytes} bytes; Teams allows at most ${TEAMS_CARD_MAX_BYTES} bytes.`,
    );
  }
}

function assertJsonData(
  value: unknown,
  seen: WeakSet<object>,
  path: string,
): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error(
        `Adaptive Card payload has a non-finite number at ${path}.`,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value))
      throw new Error(`Adaptive Card payload has a cycle at ${path}.`);
    seen.add(value);
    value.forEach((entry, index) =>
      assertJsonData(entry, seen, `${path}[${index}]`),
    );
    seen.delete(value);
    return;
  }
  if (!isRecord(value)) {
    throw new Error(
      `Adaptive Card payload must contain JSON data; found ${typeof value} at ${path}.`,
    );
  }
  if (seen.has(value))
    throw new Error(`Adaptive Card payload has a cycle at ${path}.`);
  seen.add(value);
  for (const [key, entry] of Object.entries(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.get || descriptor?.set) {
      throw new Error(
        `Adaptive Card payload cannot contain accessors (${path}.${key}).`,
      );
    }
    assertJsonData(entry, seen, `${path}.${key}`);
  }
  seen.delete(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isSupportedVersion(version: string): boolean {
  const match = /^(\d+)\.(\d+)$/.exec(version);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major < 1 || (major === 1 && minor <= 5);
}

function containsUnsupportedTeamsFeature(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsUnsupportedTeamsFeature);
  if (!isRecord(value)) return false;
  if (value.type === "Action.Execute") return true;
  return Object.values(value).some(containsUnsupportedTeamsFeature);
}
