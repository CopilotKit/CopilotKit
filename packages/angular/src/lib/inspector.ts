import { isPlatformBrowser } from "@angular/common";
import { afterNextRender, type DestroyRef } from "@angular/core";
import type { CopilotKitCore } from "@copilotkit/core";

const LOCAL_INSPECTOR_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

type InspectorElement = HTMLElement & {
  core: CopilotKitCore | null;
  autoAttachCore: boolean;
};

export function shouldEnableInspector(
  enableInspector: boolean | undefined,
  hostname: string | undefined,
): boolean {
  if (enableInspector !== undefined) return enableInspector;
  return LOCAL_INSPECTOR_HOSTS.has(hostname ?? "");
}

export function scheduleInspectorMount(input: {
  enableInspector?: boolean;
  core: CopilotKitCore;
  destroyRef: DestroyRef;
  document: Document;
  platformId: object;
}): void {
  if (!isPlatformBrowser(input.platformId)) return;

  const hostname = input.document.defaultView?.location?.hostname;
  if (!shouldEnableInspector(input.enableInspector, hostname)) return;

  let destroyed = false;
  let ownedInspector: InspectorElement | null = null;

  input.destroyRef.onDestroy(() => {
    destroyed = true;
    ownedInspector?.remove();
    ownedInspector = null;
  });

  afterNextRender(() => {
    void import("@copilotkit/web-inspector")
      .then((module) => {
        if (destroyed) return;

        module.defineWebInspector?.();
        const existing = input.document.querySelector<InspectorElement>(
          module.WEB_INSPECTOR_TAG,
        );
        const inspector =
          existing ??
          (input.document.createElement(
            module.WEB_INSPECTOR_TAG,
          ) as unknown as InspectorElement);

        inspector.autoAttachCore = false;
        inspector.core = input.core;

        if (!existing) {
          input.document.body.appendChild(inspector);
          ownedInspector = inspector;
        }
      })
      .catch((error: unknown) => {
        console.error("Failed to load CopilotKit inspector:", error);
      });
  });
}
