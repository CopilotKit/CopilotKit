import { afterNextRender, Component, DestroyRef, inject } from "@angular/core";
import { CopilotKit } from "@copilotkit/angular";
import { WEB_INSPECTOR_TAG } from "@copilotkit/web-inspector";
import type { WebInspectorElement } from "@copilotkit/web-inspector";

/**
 * Dev aid: mounts the CopilotKit web inspector (a floating panel for watching
 * AG-UI events, agent state, and runtime connectivity).
 *
 * The inspector is the framework-agnostic `cpk-web-inspector` web component.
 * Unlike React (where `<CopilotKit inspectorDefaultAnchor={...}>` renders it via
 * the provider), `@copilotkit/angular` does not integrate it, so we create the
 * element ourselves and hand it the shared `CopilotKit.core`. Safe to delete
 * this component (and its `<app-web-inspector />` usage) in production.
 */
@Component({
  selector: "app-web-inspector",
  standalone: true,
  template: "",
})
export class WebInspector {
  readonly #copilotKit = inject(CopilotKit);
  readonly #destroyRef = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      const existing =
        document.querySelector<WebInspectorElement>(WEB_INSPECTOR_TAG);
      const inspector =
        existing ??
        (document.createElement(WEB_INSPECTOR_TAG) as WebInspectorElement);

      // Hand it the app's core rather than letting it auto-attach its own.
      inspector.core = this.#copilotKit.core;
      inspector.setAttribute("auto-attach-core", "false");

      if (!existing) {
        document.body.appendChild(inspector);
      }

      this.#destroyRef.onDestroy(() => {
        if (inspector.isConnected) {
          inspector.remove();
        }
      });
    });
  }
}
