import {
  CUSTOM_ELEMENTS_SCHEMA,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  effect,
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
  defineA2UIWebComponentsOnce,
  getA2UIOperations,
  logA2UIRenderError,
  syncA2UISurface,
  type A2UISurfaceElement,
} from "./a2ui-surface-host";

@Component({
  selector: "copilot-a2ui-activity-renderer",
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="copilot-a2ui-surface-scroll"
      data-testid="a2ui-activity-surface-scroll"
    >
      <cpk-a2ui-surface
        #surface
        (a2ui-action)="handleAction($event)"
        (a2ui-error)="handleError($event)"
      ></cpk-a2ui-surface>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
        max-width: 100%;
      }

      .copilot-a2ui-surface-scroll {
        width: 100%;
        max-width: 100%;
        min-width: 0;
        overflow-x: auto;
        overflow-y: visible;
        padding: 4px 0 8px;
      }

      .copilot-a2ui-surface-scroll cpk-a2ui-surface {
        display: block;
        min-width: 100%;
      }
    `,
  ],
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
  private readonly destroyRef = inject(DestroyRef);
  private destroyed = false;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
    });

    this.ensureDefined();

    effect(() => {
      this.content();
      const surface = this.surfaceRef();
      if (!surface) return;
      this.syncSurface(surface.nativeElement);
    });
  }

  private ensureDefined(): void {
    void defineA2UIWebComponentsOnce().then(() => {
      if (this.destroyed) return;
      this.syncSurface();
    });
  }

  private syncSurface(element = this.surfaceRef()?.nativeElement): void {
    if (this.destroyed) return;
    syncA2UISurface(element, getA2UIOperations(this.content()), this.config);
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
