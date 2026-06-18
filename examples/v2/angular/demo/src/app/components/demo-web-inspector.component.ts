import { afterNextRender, Component, DestroyRef, inject } from "@angular/core";
import { CopilotKit } from "@copilotkit/angular";
import { WEB_INSPECTOR_TAG } from "@copilotkit/web-inspector";
import type { WebInspectorElement } from "@copilotkit/web-inspector";

@Component({
  selector: "angular-demo-web-inspector",
  standalone: true,
  template: "",
})
export class DemoWebInspectorComponent {
  readonly #copilotKit = inject(CopilotKit);
  readonly #destroyRef = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      const existing =
        document.querySelector<WebInspectorElement>(WEB_INSPECTOR_TAG);
      const inspector =
        existing ??
        (document.createElement(WEB_INSPECTOR_TAG) as WebInspectorElement);

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
