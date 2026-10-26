import {
  buildGenerativeUIMarkdownGuidelines,
  generativeUIGuideFeatures,
  COPILOTKIT_UI_ENVELOPE_FORMAT,
  GENERATIVE_UI_CHAT_TARGET,
  GENERATIVE_UI_FUNCTIONS,
  applyDescriptionOverrides,
  defaultGenerativeUIPromptSpec,
} from "@copilotkit/shared";
import type {
  A2UIActionMessage,
  CopilotKitUIEnvelope,
  GenerativeUIFunctionManifest,
  GenerativeUIManifest,
  GenerativeUISurfaceSummary,
  GenerativeUITarget,
} from "@copilotkit/shared";

/**
 * The built-in functions (the A2UI basic catalog plus calc and series) as
 * manifest entries. Their args are described by the short signature, not
 * by a full JSON Schema: the renderer checks them when they run. An app
 * function of the same name replaces the entry.
 */
export function builtInFunctionManifests(): Record<
  string,
  GenerativeUIFunctionManifest
> {
  return Object.fromEntries(
    Object.entries(GENERATIVE_UI_FUNCTIONS).map(([name, fn]) => [
      name,
      {
        description: fn.description,
        parameters: { type: "object", description: fn.parameters },
        returnType: fn.returnType,
        allowedCallers: fn.allowedCallers,
        ...(fn.requiresUserActivation ? { requiresUserActivation: true } : {}),
      },
    ]),
  );
}
import { catalogIdsOf } from "./catalog";
import type { GenerativeUI } from "./catalog";
import type { GenerativeUIRuntime } from "./runtime-context";

/** What `buildCatalogManifest` adds to the catalog. */
export interface CatalogManifestOptions {
  /** The app functions with a mounted handler. A built-in of the same name is left out. */
  functions?: Record<string, GenerativeUIFunctionManifest>;
  /** The inline targets, after the chat target. */
  targets?: GenerativeUITarget[];
  /** The surfaces of the thread. */
  surfaces?: Record<string, GenerativeUISurfaceSummary>;
}

/**
 * The manifest of a catalog, with no React runtime: the components of `ui`,
 * the built-in functions (minus the names the app declares) and
 * `options.functions`, the chat target and `options.targets`, and
 * `options.surfaces`. `buildGenerativeUIManifest` builds the per-run
 * manifest with it; tools that run outside React use it directly.
 *
 * @example
 * ```ts
 * const manifest = buildCatalogManifest(standardUI);
 * manifest.targets; // [{ id: "chat", kind: "chat" }]
 * ```
 */
export function buildCatalogManifest(
  ui: Pick<GenerativeUI, "id" | "manifestComponents" | "functions">,
  options: CatalogManifestOptions = {},
): GenerativeUIManifest {
  return {
    catalogId: ui.id,
    catalogIds: catalogIdsOf(ui),
    // The description overrides of the default prompt spec (none today), so
    // the client sends the descriptions that evaluations measure.
    components: applyDescriptionOverrides(
      { components: ui.manifestComponents },
      defaultGenerativeUIPromptSpec().descriptions,
    ).manifest.components,
    // A name the app declares is the app's, also while its handler is not
    // mounted: the dispatcher never runs the built-in in its place.
    functions: {
      ...Object.fromEntries(
        Object.entries(builtInFunctionManifests()).filter(
          ([name]) => !ui.functions.has(name),
        ),
      ),
      ...options.functions,
    },
    targets: [
      { id: GENERATIVE_UI_CHAT_TARGET, kind: "chat" },
      ...(options.targets ?? []),
    ],
    surfaces: options.surfaces ?? {},
  };
}

/**
 * Builds the per-run manifest. Never contains handlers or renderers.
 *
 * - `functions`: the built-in functions, then the declared functions with
 *   exactly one mounted handler.
 * - `targets`: the chat first, then each mounted `<GenerativeUISurface>`,
 *   with its `description` and its `components` when it has them.
 */
export function buildGenerativeUIManifest(
  runtime: Pick<GenerativeUIRuntime, "ui" | "manager" | "dispatcher">,
  threadId: string | undefined,
) {
  const { ui, manager, dispatcher } = runtime;
  const inlineTargets = manager
    .getMountedTargets()
    .filter((target) => target.id !== GENERATIVE_UI_CHAT_TARGET)
    .map(({ id, ...rest }) => ({ id, kind: "inline" as const, ...rest }));
  return buildCatalogManifest(ui, {
    functions: dispatcher.listExposed(),
    targets: inlineTargets,
    surfaces: threadId ? manager.describeSurfaces(threadId) : {},
  });
}

/** How to build the envelope of one run. */
export interface GenerativeUIEnvelopeOptions {
  transport: CopilotKitUIEnvelope["metadata"]["extensions"]["copilotkit_transport"];
  /**
   * Send the component schemas. The tool transport always sends them,
   * because the runtime validates operations with them.
   */
  includeCatalog: boolean;
  /** True when the client also sends the guide as context entries. */
  contextSent: boolean;
  /**
   * The markdown guideline. Left out, the markdown transport builds it from
   * the manifest, with only the rule groups that the manifest uses. The
   * tool transport sends none.
   */
  instructions?: string;
  /** The user action that starts this run, when one does. */
  action?: A2UIActionMessage;
}

/**
 * Builds the envelope that a run sends as `forwardedProps.copilotkit.ui`,
 * from the per-run manifest. It has the A2UI v1.0 renderer capabilities
 * shape: one inline catalog with the id of the UI, and the CopilotKit data
 * in `metadata.extensions`.
 *
 * The inline catalog has no `components` only for the markdown transport
 * with `includeCatalog: false`. It has `instructions` for the markdown
 * transport, or when given.
 *
 * @param runtime - The generative UI runtime of the provider.
 * @param threadId - The thread of the run. Its surfaces go in `copilotkit_surfaces`.
 * @param options - The transport and what to send.
 *
 * @example
 * ```ts
 * const envelope = buildGenerativeUIEnvelope(runtime, agent.threadId, {
 *   transport: "tool",
 *   includeCatalog: true,
 *   contextSent: false,
 * });
 * envelope["v1.0"].supportedCatalogIds; // [runtime.ui.id]
 * ```
 */
export function buildGenerativeUIEnvelope(
  runtime: Pick<GenerativeUIRuntime, "ui" | "manager" | "dispatcher">,
  threadId: string | undefined,
  options: GenerativeUIEnvelopeOptions,
) {
  const { transport, includeCatalog, contextSent, action } = options;
  const manifest = buildGenerativeUIManifest(runtime, threadId);
  // The markdown guideline has only the rule groups that this manifest uses.
  const instructions =
    options.instructions ??
    (transport === "markdown"
      ? buildGenerativeUIMarkdownGuidelines(generativeUIGuideFeatures(manifest))
      : undefined);
  const omitComponents = transport === "markdown" && !includeCatalog;
  const envelope: CopilotKitUIEnvelope = {
    "v1.0": {
      supportedCatalogIds: manifest.catalogIds ?? [manifest.catalogId],
      inlineCatalogs: [
        {
          catalogId: manifest.catalogId,
          protocolVersion: "1.0",
          ...(omitComponents ? {} : { components: manifest.components }),
          functions: manifest.functions,
          ...(instructions === undefined ? {} : { instructions }),
        },
      ],
    },
    metadata: {
      extensions: {
        copilotkit_format: COPILOTKIT_UI_ENVELOPE_FORMAT,
        copilotkit_transport: transport,
        copilotkit_targets: manifest.targets,
        copilotkit_surfaces: manifest.surfaces,
        copilotkit_contextSent: contextSent,
        ...(action === undefined ? {} : { copilotkit_action: action }),
      },
    },
  };
  return envelope;
}
