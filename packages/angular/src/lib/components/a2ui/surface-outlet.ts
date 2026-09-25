import { Component, computed, inject, input, output } from "@angular/core";
import type { AbstractAgent } from "@ag-ui/client";
import type { A2UIClientEventMessage } from "@copilotkit/a2ui-renderer/web-components";
import { COPILOT_KIT_CONFIG } from "../../config";
import { CopilotKit } from "../../copilotkit";
import { CopilotSlot } from "../../slots/copilot-slot";
import type { SlotOutputs } from "../../slots/slot.types";
import { bridgeA2UIAction, logA2UIRenderError } from "./a2ui-surface-host";
import { CopilotA2UILitSurface } from "./lit-surface";
import { isNativeA2UICatalog } from "./native-catalog";

/**
 * @internal
 * Renders operations with the configured catalog's own renderer, or the Lit
 * one, sends its actions to `agent` and logs its render errors.
 */
@Component({
  selector: "copilot-a2ui-surface-outlet",
  imports: [CopilotSlot],
  host: { style: "display: contents" },
  template: `
    <copilot-slot
      style="display: contents"
      [slot]="component"
      [context]="context()"
      [outputs]="outputs"
    />
  `,
})
export class CopilotA2UISurfaceOutlet {
  readonly operations = input<readonly unknown[]>([]);
  readonly agent = input<AbstractAgent | undefined>();
  readonly rendered = output<void>();

  private readonly a2ui = inject(COPILOT_KIT_CONFIG, { optional: true })?.a2ui;
  private readonly copilotKit = inject(CopilotKit, { optional: true });

  protected readonly component = isNativeA2UICatalog(this.a2ui?.catalog)
    ? this.a2ui.catalog.surfaceComponent
    : CopilotA2UILitSurface;

  protected readonly context = computed(() => ({
    catalog: this.a2ui?.catalog,
    operations: this.operations(),
    theme: this.a2ui?.theme,
    loadingComponent: this.a2ui?.loadingComponent,
  }));

  protected readonly outputs: SlotOutputs = {
    action: (message: A2UIClientEventMessage) =>
      bridgeA2UIAction(this.copilotKit, this.agent(), message),
    error: logA2UIRenderError,
    rendered: () => this.rendered.emit(),
  };
}
