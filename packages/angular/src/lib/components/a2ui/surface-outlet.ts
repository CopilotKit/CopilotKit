import { Component, computed, inject, input, output } from "@angular/core";
import { AbstractAgent } from "@ag-ui/client";
import { ɵrunA2UIAction } from "@copilotkit/core";
import { COPILOT_KIT_CONFIG } from "../../config";
import { CopilotKit } from "../../copilotkit";
import { CopilotSlot } from "../../slots/copilot-slot";
import { SlotOutputs } from "../../slots/slot.types";
import { A2UIClientEventMessage, A2UISurfaceError } from "./a2ui-types";

/**
 * @internal
 * Renders operations with the configured catalog's surface, sends its actions
 * to `agent` through the configured `onAction` interceptor, and logs its
 * render errors.
 */
@Component({
  selector: "copilot-a2ui-surface-outlet",
  imports: [CopilotSlot],
  host: { style: "display: contents" },
  template: `
    @if (a2ui?.catalog; as catalog) {
      <copilot-slot
        style="display: contents"
        [slot]="catalog.surfaceComponent"
        [context]="context()"
        [outputs]="outputs"
      />
    }
  `,
})
export class CopilotA2UISurfaceOutlet {
  readonly operations = input<readonly unknown[]>([]);
  readonly agent = input<AbstractAgent | undefined>();
  readonly rendered = output<void>();

  protected readonly a2ui = inject(COPILOT_KIT_CONFIG, { optional: true })
    ?.a2ui;
  private readonly copilotKit = inject(CopilotKit, { optional: true });

  protected readonly context = computed(() => ({
    catalog: this.a2ui?.catalog,
    operations: this.operations(),
    theme: this.a2ui?.theme,
    loadingComponent: this.a2ui?.loadingComponent,
  }));

  protected readonly outputs: SlotOutputs = {
    action: async (message: A2UIClientEventMessage) => {
      const core = this.copilotKit?.core;
      if (!core) return;
      await ɵrunA2UIAction({
        message,
        agent: this.agent(),
        core,
        onAction: this.a2ui?.onAction,
      });
    },
    error: (error: A2UISurfaceError) =>
      console.warn("[A2UI Angular] render error:", error),
    rendered: () => this.rendered.emit(),
  };
}
