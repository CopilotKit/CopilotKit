/**
 * The generative UI envelope that the client sends on every run as
 * `forwardedProps.copilotkit.ui`. It has the A2UI v1.0 renderer capabilities
 * shape, so a backend that speaks A2UI v1.0 can read the catalog as it is.
 * CopilotKit data goes in `metadata.extensions`, under `copilotkit_` keys.
 * The runtime reads it to pick the transport and to build the guide.
 */
import {
  GENERATIVE_UI_MAX_REJECTION_LENGTH,
  GENERATIVE_UI_MAX_SUMMARY_REJECTIONS,
  GENERATIVE_UI_MAX_TARGET_COMPONENTS,
} from "./generative-ui/types";
import type {
  A2UIActionMessage,
  GenerativeUIComponentManifest,
  GenerativeUIFunctionManifest,
  GenerativeUIManifest,
  GenerativeUISurfaceSummary,
  GenerativeUITarget,
} from "./generative-ui/types";

/** Top-level `forwardedProps` key that holds the CopilotKit run properties. */
export const COPILOTKIT_FORWARDED_PROPS_KEY = "copilotkit";

/** Version of the envelope shape (not of the UI protocol that it carries). */
export const COPILOTKIT_UI_ENVELOPE_FORMAT = 3;

/** What the client renders and calls, and how the model must write UI. */
export interface CopilotKitUIEnvelope {
  /** The A2UI v1.0 renderer capabilities. */
  "v1.0": {
    /** The catalog that the client renders comes first. */
    supportedCatalogIds: string[];
    inlineCatalogs?: Array<{
      catalogId: string;
      protocolVersion: "1.0";
      /** Not there when the client is set up with `includeCatalog: false`. */
      components?: Record<string, GenerativeUIComponentManifest>;
      /** The app functions that are mounted now. */
      functions: Record<string, GenerativeUIFunctionManifest>;
      /** The markdown guideline. Only the markdown transport sends it. */
      instructions?: string;
    }>;
  };
  metadata: {
    extensions: {
      /** Envelope shape version. */
      copilotkit_format: typeof COPILOTKIT_UI_ENVELOPE_FORMAT;
      /** "tool": the model calls the render tool. "markdown": the model writes ```a2ui fences. */
      copilotkit_transport: "tool" | "markdown";
      copilotkit_targets: GenerativeUIManifest["targets"];
      copilotkit_surfaces: GenerativeUIManifest["surfaces"];
      /** True when the client also sent the guide as context entries on this run. */
      copilotkit_contextSent: boolean;
      /**
       * The A2UI action that started this run, when a user event did: the
       * structured form of the user message that the event added.
       */
      copilotkit_action?: A2UIActionMessage;
    };
  };
}

type InlineCatalog = NonNullable<
  CopilotKitUIEnvelope["v1.0"]["inlineCatalogs"]
>[number];
type Extensions = CopilotKitUIEnvelope["metadata"]["extensions"];

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

function isInlineCatalog(value: unknown): value is InlineCatalog {
  return (
    isRecord(value) &&
    isNonEmptyString(value.catalogId) &&
    value.protocolVersion === "1.0" &&
    (value.components === undefined ||
      isRecordOf(value.components, isComponentManifest)) &&
    isRecordOf(value.functions, isSchemaEntry) &&
    isOptionalString(value.instructions)
  );
}

function isCapabilities(value: unknown): value is CopilotKitUIEnvelope["v1.0"] {
  return (
    isRecord(value) &&
    Array.isArray(value.supportedCatalogIds) &&
    value.supportedCatalogIds.length > 0 &&
    value.supportedCatalogIds.every(isNonEmptyString) &&
    (value.inlineCatalogs === undefined ||
      (Array.isArray(value.inlineCatalogs) &&
        value.inlineCatalogs.every(isInlineCatalog)))
  );
}

/** A short list of component names. */
function isComponentNameList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= GENERATIVE_UI_MAX_TARGET_COMPONENTS &&
    value.every(isNonEmptyString)
  );
}

function isTarget(value: unknown): value is GenerativeUITarget {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    (value.kind === "chat" || value.kind === "inline") &&
    isOptionalString(value.description) &&
    (value.components === undefined || isComponentNameList(value.components))
  );
}

/** A short list of short strings. The summary limits keep the guide small. */
function isRejectionList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= GENERATIVE_UI_MAX_SUMMARY_REJECTIONS &&
    value.every(
      (entry) =>
        typeof entry === "string" &&
        entry.length <= GENERATIVE_UI_MAX_REJECTION_LENGTH,
    )
  );
}

function isSurfaceEntry(value: unknown): value is GenerativeUISurfaceSummary {
  return (
    isRecord(value) &&
    isNonEmptyString(value.target) &&
    (value.dataModel === undefined || isRecord(value.dataModel)) &&
    (value.rejected === undefined || isRejectionList(value.rejected))
  );
}

/** Checks the `copilotkit_` keys only. Other extensions can be there too. */
function isExtensions(value: unknown): value is Extensions {
  return (
    isRecord(value) &&
    value.copilotkit_format === COPILOTKIT_UI_ENVELOPE_FORMAT &&
    (value.copilotkit_transport === "tool" ||
      value.copilotkit_transport === "markdown") &&
    Array.isArray(value.copilotkit_targets) &&
    value.copilotkit_targets.every(isTarget) &&
    isRecordOf(value.copilotkit_surfaces, isSurfaceEntry) &&
    typeof value.copilotkit_contextSent === "boolean"
  );
}

function isEnvelope(value: unknown): value is CopilotKitUIEnvelope {
  return (
    isRecord(value) &&
    isCapabilities(value["v1.0"]) &&
    isRecord(value.metadata) &&
    isExtensions(value.metadata.extensions)
  );
}

/**
 * Reads the generative UI envelope from the `forwardedProps` of a run.
 *
 * The envelope comes from the client, so it is not trusted: every field is
 * checked. Returns `undefined` when the envelope is not there, or when it is
 * malformed (for example a wrong `copilotkit_format` or
 * `copilotkit_transport`, or no catalog id).
 *
 * @param forwardedProps - The `forwardedProps` of the run input.
 *
 * @example
 * ```ts
 * const envelope = readCopilotKitUIEnvelope(input.forwardedProps);
 * if (envelope?.metadata.extensions.copilotkit_transport === "markdown") {
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

/**
 * Turns an envelope into the manifest that the runtime and the prompts use.
 *
 * The catalog is the first of `supportedCatalogIds`. Its components,
 * functions, and instructions come from the inline catalog with that id.
 * With no such inline catalog, there are no components and no functions.
 *
 * The result also has:
 * - `transport` and `contextSent`, from the extensions.
 * - `instructions`, when the inline catalog has them.
 * - `hasComponents`: false when the client left the component schemas out.
 *   The runtime cannot check operations without them.
 * - `action`: the A2UI action message of the user event that started the
 *   run, when one did.
 *
 * @param envelope - An envelope from `readCopilotKitUIEnvelope`.
 *
 * @example
 * ```ts
 * const envelope = readCopilotKitUIEnvelope(input.forwardedProps);
 * const manifest = envelope && envelopeToManifest(envelope);
 * if (manifest?.transport === "tool" && manifest.hasComponents) {
 *   // Add the render tool and validate operations against manifest.components.
 * }
 * ```
 */
export function envelopeToManifest(envelope: CopilotKitUIEnvelope) {
  const { supportedCatalogIds, inlineCatalogs } = envelope["v1.0"];
  const catalogId = supportedCatalogIds[0];
  const catalog = inlineCatalogs?.find(
    (entry) => entry.catalogId === catalogId,
  );
  const extensions = envelope.metadata.extensions;
  const manifest: GenerativeUIManifest = {
    catalogId,
    components: catalog?.components ?? {},
    functions: catalog?.functions ?? {},
    targets: extensions.copilotkit_targets,
    surfaces: extensions.copilotkit_surfaces,
  };
  return {
    ...manifest,
    transport: extensions.copilotkit_transport,
    contextSent: extensions.copilotkit_contextSent,
    instructions: catalog?.instructions,
    hasComponents: catalog?.components !== undefined,
    action: extensions.copilotkit_action,
  };
}
