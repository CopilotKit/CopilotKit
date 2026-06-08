import {
  CUSTOM_ELEMENTS_SCHEMA,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  viewChild,
} from "@angular/core";
import type { AbstractAgent, ActivityMessage } from "@ag-ui/client";
import type { ActivityRenderer } from "../../activity-renderer";
import { CopilotKit } from "../../copilotkit";
import { injectCopilotKitConfig } from "../../config";
import {
  bridgeA2UIAction,
  connectA2UISurface,
  getA2UIOperations,
  logA2UIRenderError,
  type A2UISurfaceElement,
} from "./a2ui-surface-host";

@Component({
  selector: "copilot-a2ui-activity-renderer",
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  host: {
    class: "copilot-a2ui-surface-renderer-layout",
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="copilot-a2ui-surface-scroll"
      data-testid="a2ui-activity-surface-scroll"
    >
      <cpk-a2ui-surface
        #surface
        class="copilot-a2ui-surface-scroll-surface"
        (a2ui-action)="handleAction($event)"
        (a2ui-error)="handleError($event)"
      ></cpk-a2ui-surface>
    </div>
  `,
})
export class CopilotA2UIActivityRenderer implements ActivityRenderer<unknown> {
  readonly activityType = input.required<string>();
  readonly content = input.required<unknown>();
  readonly message = input.required<ActivityMessage>();
  readonly agent = input<AbstractAgent | undefined>();

  private readonly surfaceRef = viewChild<
    unknown,
    ElementRef<A2UISurfaceElement>
  >("surface", { read: ElementRef });

  private readonly copilotKit = inject(CopilotKit);
  private readonly config = injectCopilotKitConfig();

  constructor() {
    connectA2UISurface({
      surfaceRef: this.surfaceRef,
      operations: () => getA2UIOperations(this.content()),
      config: this.config,
    });
  }

  protected async handleAction(event: Event): Promise<void> {
    await bridgeA2UIAction(
      this.copilotKit,
      this.agent(),
      (event as CustomEvent).detail,
    );
  }

  protected handleError(event: Event): void {
    logA2UIRenderError(event);
  }
}
