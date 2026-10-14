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

/** Builds the per-run manifest. Never contains handlers or renderers. */
export function buildGenerativeUIManifest(
  runtime: Pick<GenerativeUIRuntime, "catalog" | "manager" | "dispatcher">,
  threadId: string | undefined,
): GenerativeUIManifest {
  const { catalog, manager, dispatcher } = runtime;
  return {
    catalogId: catalog.id,
    catalogVersion: `fnv1a:${fnv1a(JSON.stringify({ id: catalog.id, components: catalog.manifestComponents }))}`,
    components: catalog.manifestComponents,
    functions: dispatcher.listExposed(),
    appState: manager.getAppStateKeys(),
    targets: [
      { id: GENERATIVE_UI_CHAT_TARGET, kind: "chat" },
      ...manager
        .getMountedTargets()
        .filter((id) => id !== GENERATIVE_UI_CHAT_TARGET)
        .map((id) => ({ id, kind: "inline" as const })),
    ],
    surfaces: threadId ? manager.describeSurfaces(threadId) : {},
  };
}
