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
  validateAdaptiveCardStructure(payload);
  const bytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  if (bytes > TEAMS_CARD_MAX_BYTES) {
    throw new Error(
      `Adaptive Card payload is ${bytes} bytes; Teams allows at most ${TEAMS_CARD_MAX_BYTES} bytes.`,
    );
  }
}

const CARD_ELEMENTS = new Set([
  "ActionSet",
  "Column",
  "ColumnSet",
  "Container",
  "FactSet",
  "Image",
  "ImageSet",
  "Input.ChoiceSet",
  "Input.Date",
  "Input.Number",
  "Input.Text",
  "Input.Time",
  "Input.Toggle",
  "Media",
  "RichTextBlock",
  "Table",
  "TextBlock",
]);
const ACTIONS = new Set([
  "Action.OpenUrl",
  "Action.ShowCard",
  "Action.Submit",
  "Action.ToggleVisibility",
]);
const CERTIFIED_ELEMENTS = new Set([
  "ActionSet",
  "Column",
  "ColumnSet",
  "Container",
  "FactSet",
  "Image",
  "ImageSet",
  "Input.ChoiceSet",
  "Input.Date",
  "Input.Number",
  "Input.Text",
  "Input.Time",
  "Input.Toggle",
  "RichTextBlock",
  "Table",
  "TextBlock",
  "Action.OpenUrl",
  "Action.Submit",
]);

/**
 * Validate the part of the pinned Teams host profile that changes tree shape.
 * This prevents malformed raw payloads from reaching Teams while retaining the
 * raw-card escape hatch for known-but-not-yet-certified Adaptive Card features.
 */
function validateAdaptiveCardStructure(card: Record<string, unknown>): void {
  validateElementArray(card.body, "card.body");
  if (card.actions !== undefined)
    validateActionArray(card.actions, "card.actions");
}

function validateElementArray(value: unknown, path: string): void {
  if (!Array.isArray(value)) {
    throw new Error(`Adaptive Card ${path} must be an array.`);
  }
  value.forEach((element, index) =>
    validateElement(element, `${path}[${index}]`),
  );
}

function validateActionArray(value: unknown, path: string): void {
  if (!Array.isArray(value)) {
    throw new Error(`Adaptive Card ${path} must be an array.`);
  }
  value.forEach((action, index) => validateAction(action, `${path}[${index}]`));
}

function validateElement(value: unknown, path: string): void {
  const element = requireTypedRecord(value, path);
  const type = requireType(element, path, CARD_ELEMENTS);
  warnUncertified(type, path);

  switch (type) {
    case "ActionSet":
      validateActionArray(element.actions, `${path}.actions`);
      return;
    case "Column":
    case "Container":
      validateOptionalElementArray(element.items, `${path}.items`);
      return;
    case "ColumnSet":
      validateOptionalTypedArray(element.columns, `${path}.columns`, "Column");
      return;
    case "ImageSet":
      validateOptionalTypedArray(element.images, `${path}.images`, "Image");
      return;
    case "RichTextBlock":
      validateOptionalTypedArray(element.inlines, `${path}.inlines`, "TextRun");
      return;
    case "Table":
      validateOptionalTypedArray(element.rows, `${path}.rows`, "TableRow");
      return;
    case "FactSet":
      validateOptionalTypedArray(element.facts, `${path}.facts`, "Fact");
      return;
    case "TextBlock":
      if (typeof element.text !== "string") {
        throw new Error(`Adaptive Card ${path}.text must be a string.`);
      }
      return;
    case "Image":
      if (typeof element.url !== "string") {
        throw new Error(`Adaptive Card ${path}.url must be a string.`);
      }
      return;
    default:
      if (type.startsWith("Input.") && typeof element.id !== "string") {
        throw new Error(`Adaptive Card ${path}.id must be a string.`);
      }
  }
}

function validateAction(value: unknown, path: string): void {
  const action = requireTypedRecord(value, path);
  const type = requireType(action, path, ACTIONS);
  warnUncertified(type, path);
  if (type === "Action.OpenUrl" && typeof action.url !== "string") {
    throw new Error(`Adaptive Card ${path}.url must be a string.`);
  }
}

function validateOptionalElementArray(value: unknown, path: string): void {
  if (value !== undefined) validateElementArray(value, path);
}

function validateOptionalTypedArray(
  value: unknown,
  path: string,
  expectedType: string,
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw new Error(`Adaptive Card ${path} must be an array.`);
  }
  value.forEach((entry, index) => {
    const item = requireTypedRecord(entry, `${path}[${index}]`);
    if (item.type !== expectedType) {
      throw new Error(
        `Adaptive Card ${path}[${index}] must have type ${expectedType}.`,
      );
    }
  });
}

function requireTypedRecord(
  value: unknown,
  path: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Adaptive Card ${path} must be an object.`);
  }
  return value;
}

function requireType(
  value: Record<string, unknown>,
  path: string,
  allowed: ReadonlySet<string>,
): string {
  const type = value.type;
  if (typeof type !== "string" || !allowed.has(type)) {
    throw new Error(
      `Adaptive Card ${path} has an unsupported type ${String(type)}.`,
    );
  }
  return type;
}

function warnUncertified(type: string, path: string): void {
  if (CERTIFIED_ELEMENTS.has(type) || process.env.NODE_ENV === "production") {
    return;
  }
  console.warn(
    `[channels-teams] ${type} at ${path} is schema-valid but not yet certified for the Teams host profile.`,
  );
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
