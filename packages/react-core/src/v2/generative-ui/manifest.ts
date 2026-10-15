import { GENERATIVE_UI_CHAT_TARGET } from "@copilotkit/shared";
import type { GenerativeUIManifest } from "@copilotkit/shared";
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
