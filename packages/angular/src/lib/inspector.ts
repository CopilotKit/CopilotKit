import { isPlatformBrowser } from "@angular/common";
import {
  afterNextRender,
  InjectionToken,
  isDevMode,
  type DestroyRef,
} from "@angular/core";
import type { CopilotKitCore } from "@copilotkit/core";
import { shouldEnableInspector } from "@copilotkit/shared";
import type { WebInspectorElement } from "@copilotkit/web-inspector";

type InspectorElement = WebInspectorElement;

export const ɵCOPILOTKIT_INSPECTOR_DEVELOPMENT_MODE =
  new InjectionToken<boolean>("CopilotKit Inspector development mode", {
    factory: isDevMode,
  });

export function scheduleInspectorMount(input: {
  enableInspector?: boolean;
  isDevelopment: boolean;
  core: CopilotKitCore;
  destroyRef: DestroyRef;
  document: Document;
  platformId: object;
}): void {
  if (
    !shouldEnableInspector({
      enableInspector: input.enableInspector,
      isBrowser: isPlatformBrowser(input.platformId),
      isDevelopment: input.isDevelopment,
    })
  ) {
    return;
  }

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

        module.configureWebInspectorElement(inspector, input.core);

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
