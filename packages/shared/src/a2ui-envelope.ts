/**
 * The generative UI envelope that the client sends on every run as
 * `forwardedProps.copilotkit.ui`. The runtime reads it to pick the transport
 * and to build the guide. Backends that build their own prompt read it too.
 */
import type {
  GenerativeUIComponentManifest,
  GenerativeUIFunctionManifest,
  GenerativeUIManifest,
} from "./generative-ui/types";

/** Top-level `forwardedProps` key that holds the CopilotKit run properties. */
export const COPILOTKIT_FORWARDED_PROPS_KEY = "copilotkit";

/** Version of the envelope shape (not of the UI protocol that it carries). */
export const COPILOTKIT_UI_ENVELOPE_FORMAT = 2;

/** What the client renders and calls, and how the model must write UI. */
export interface CopilotKitUIEnvelope {
  /** The generative UI protocol. */
  method: "a2ui";
  /** The A2UI version of the operations. */
  version: "v0.9";
  /** Envelope shape version. */
  format: typeof COPILOTKIT_UI_ENVELOPE_FORMAT;
  /** "tool": the model calls the render tool. "markdown": the model writes ```a2ui fences. */
  transport: "tool" | "markdown";
  /**
   * The catalog that the client renders. `components` is not there when the
   * client is set up with `includeCatalog: false`.
   */
  catalog: {
    id: string;
    version: string;
    components?: Record<string, GenerativeUIComponentManifest>;
  };
  functions: Record<string, GenerativeUIFunctionManifest>;
  targets: GenerativeUIManifest["targets"];
  surfaces: GenerativeUIManifest["surfaces"];
  /** The markdown guideline. Only the markdown transport sends it. */
  instructions?: string;
  /** True when the client also sent the guide as context entries on this run. */
  contextSent: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown) {
  return value === undefined || typeof value === "string";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function isRecordOf<T>(
  value: unknown,
  isEntry: (entry: unknown) => entry is T,
): value is Record<string, T> {
  return isRecord(value) && Object.values(value).every(isEntry);
}

/** A function, or an event of a component: a description and a parameter schema. */
function isSchemaEntry(value: unknown): value is GenerativeUIFunctionManifest {
  return (
    isRecord(value) &&
    isRecord(value.parameters) &&
    isOptionalString(value.description)
  );
}

function isSlotKind(value: unknown): value is "single" | "multiple" {
  return value === "single" || value === "multiple";
}

/**
 * `validateOperation` reads `properties` and `required` of a props schema,
 * so those two must have the right shape when they are there.
 */
function isPropsSchema(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    (value.properties === undefined || isRecord(value.properties)) &&
    (value.required === undefined ||
      (Array.isArray(value.required) &&
        value.required.every((name) => typeof name === "string")))
  );
}

function isComponentManifest(
  value: unknown,
): value is GenerativeUIComponentManifest {
  return (
    isRecord(value) &&
    isPropsSchema(value.props) &&
    isOptionalString(value.description) &&
    (value.events === undefined || isRecordOf(value.events, isSchemaEntry)) &&
    (value.slots === undefined || isRecordOf(value.slots, isSlotKind))
  );
}

function isCatalog(value: unknown): value is CopilotKitUIEnvelope["catalog"] {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    typeof value.version === "string" &&
    (value.components === undefined ||
      isRecordOf(value.components, isComponentManifest))
  );
}

type GenerativeUITarget = GenerativeUIManifest["targets"][number];

function isTarget(value: unknown): value is GenerativeUITarget {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    (value.kind === "chat" || value.kind === "inline") &&
    isOptionalString(value.description)
  );
}

function isSurfaceEntry(value: unknown): value is { target: string } {
  return isRecord(value) && isNonEmptyString(value.target);
}

function isEnvelope(value: unknown): value is CopilotKitUIEnvelope {
  return (
    isRecord(value) &&
    value.method === "a2ui" &&
    value.version === "v0.9" &&
    value.format === COPILOTKIT_UI_ENVELOPE_FORMAT &&
    (value.transport === "tool" || value.transport === "markdown") &&
    isCatalog(value.catalog) &&
    isRecordOf(value.functions, isSchemaEntry) &&
    Array.isArray(value.targets) &&
    value.targets.every(isTarget) &&
    isRecordOf(value.surfaces, isSurfaceEntry) &&
    isOptionalString(value.instructions) &&
    typeof value.contextSent === "boolean"
  );
}

/**
 * Reads the generative UI envelope from the `forwardedProps` of a run.
 *
 * The envelope comes from the client, so it is not trusted: every field is
 * checked. Returns `undefined` when the envelope is not there, or when it is
 * malformed (for example a wrong `method`, `transport`, or `format`, or no
 * catalog id).
 *
 * @param forwardedProps - The `forwardedProps` of the run input.
 *
 * @example
 * ```ts
 * const envelope = readCopilotKitUIEnvelope(input.forwardedProps);
 * if (envelope?.transport === "markdown") {
 *   // The model writes ```a2ui fences. Add no render tool.
 * }
 * ```
 */
export function readCopilotKitUIEnvelope(forwardedProps: unknown) {
  if (!isRecord(forwardedProps)) return undefined;
  const namespace = forwardedProps[COPILOTKIT_FORWARDED_PROPS_KEY];
  if (!isRecord(namespace)) return undefined;
  const envelope = namespace.ui;
  return isEnvelope(envelope) ? envelope : undefined;
}
