import {
  A2UI_VERSION,
  COPILOTKIT_UI_ENVELOPE_FORMAT,
  GENERATIVE_UI_CHAT_TARGET,
} from "@copilotkit/shared";
import type {
  CopilotKitUIEnvelope,
  GenerativeUIManifest,
} from "@copilotkit/shared";
import type { GenerativeUIRuntime } from "./runtime-context";

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

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
    catalogVersion: `fnv1a:${fnv1a(JSON.stringify({ id: ui.id, components: ui.manifestComponents }))}`,
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
export type GenerativeUIEnvelopeOptions = Pick<
  CopilotKitUIEnvelope,
  "transport" | "contextSent" | "instructions"
> & {
  /**
   * Send the component schemas. The tool transport always sends them,
   * because the runtime validates operations with them.
   */
  includeCatalog: boolean;
};

/**
 * Builds the envelope that a run sends as `forwardedProps.copilotkit.ui`,
 * from the per-run manifest.
 *
 * `catalog.components` is left out only for the markdown transport with
 * `includeCatalog: false`. `instructions` is there only when given.
 *
 * @param runtime - The generative UI runtime of the provider.
 * @param threadId - The thread of the run. Its surfaces go in `surfaces`.
 * @param options - The transport and what to send.
 *
 * @example
 * ```ts
 * const envelope = buildGenerativeUIEnvelope(runtime, agent.threadId, {
 *   transport: "tool",
 *   includeCatalog: true,
 *   contextSent: false,
 * });
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
  const catalog = { id: manifest.catalogId, version: manifest.catalogVersion };
  const envelope: CopilotKitUIEnvelope = {
    method: "a2ui",
    version: A2UI_VERSION,
    format: COPILOTKIT_UI_ENVELOPE_FORMAT,
    transport,
    catalog: omitComponents
      ? catalog
      : { ...catalog, components: manifest.components },
    functions: manifest.functions,
    targets: manifest.targets,
    surfaces: manifest.surfaces,
    ...(instructions === undefined ? {} : { instructions }),
    contextSent,
  };
  return envelope;
}
