import {
  COPILOTKIT_UI_ENVELOPE_FORMAT,
  GENERATIVE_UI_CHAT_TARGET,
} from "@copilotkit/shared";
import type {
  CopilotKitUIEnvelope,
  GenerativeUIManifest,
} from "@copilotkit/shared";
import type { GenerativeUIRuntime } from "./runtime-context";

/**
 * Builds the per-run manifest. Never contains handlers or renderers.
 *
 * - `functions`: the declared functions with exactly one mounted handler.
 * - `targets`: the chat first, then each mounted `<GenerativeUISurface>`,
 *   with its `description` when it has one.
 */
export function buildGenerativeUIManifest(
  runtime: Pick<GenerativeUIRuntime, "ui" | "manager" | "dispatcher">,
  threadId: string | undefined,
) {
  const { ui, manager, dispatcher } = runtime;
  const inlineTargets = manager
    .getMountedTargets()
    .filter((target) => target.id !== GENERATIVE_UI_CHAT_TARGET)
    .map(({ id, description }) =>
      description === undefined
        ? { id, kind: "inline" as const }
        : { id, kind: "inline" as const, description },
    );
  const manifest: GenerativeUIManifest = {
    catalogId: ui.id,
    components: ui.manifestComponents,
    functions: dispatcher.listExposed(),
    targets: [
      { id: GENERATIVE_UI_CHAT_TARGET, kind: "chat" },
      ...inlineTargets,
    ],
    surfaces: threadId ? manager.describeSurfaces(threadId) : {},
  };
  return manifest;
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
  /** The markdown guideline. The inline catalog has it only when given. */
  instructions?: string;
}

/**
 * Builds the envelope that a run sends as `forwardedProps.copilotkit.ui`,
 * from the per-run manifest. It has the A2UI v1.0 renderer capabilities
 * shape: one inline catalog with the id of the UI, and the CopilotKit data
 * in `metadata.extensions`.
 *
 * The inline catalog has no `components` only for the markdown transport
 * with `includeCatalog: false`. It has `instructions` only when given.
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
  const { transport, includeCatalog, contextSent, instructions } = options;
  const manifest = buildGenerativeUIManifest(runtime, threadId);
  const omitComponents = transport === "markdown" && !includeCatalog;
  const envelope: CopilotKitUIEnvelope = {
    "v1.0": {
      supportedCatalogIds: [manifest.catalogId],
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
      },
    },
  };
  return envelope;
}
