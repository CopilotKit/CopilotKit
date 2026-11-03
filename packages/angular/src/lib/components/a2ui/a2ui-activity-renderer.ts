import { Component, DestroyRef, inject, input, signal } from "@angular/core";
import type { AbstractAgent, ActivityMessage } from "@ag-ui/client";
import { ɵA2UIActivityController } from "@copilotkit/core";
import type { ɵA2UIActivitySnapshot } from "@copilotkit/core";
import type { ActivityRenderer } from "../../activity-renderer";
import { injectCopilotKitConfig } from "../../config";
import { explicitEffect } from "../../explicit-effect";
import { CopilotA2UILifecycleView } from "./a2ui-lifecycle-view";
import { injectA2UIControllerScheduling } from "./a2ui-scheduling";
import { CopilotA2UISurfaceOutlet } from "./surface-outlet";

/**
 * Renders an `a2ui-surface` activity: the lifecycle state before paint, then
 * the surface, kept hidden under the loader until it has painted. Core's
 * `ɵA2UIActivityController` decides which.
 */
@Component({
  selector: "copilot-a2ui-activity-renderer",
  imports: [CopilotA2UILifecycleView, CopilotA2UISurfaceOutlet],
  host: {
    class: "copilot-a2ui-surface-renderer-layout",
  },
  template: `
    @let state = snapshot();
    @if (state.view === "lifecycle") {
      <copilot-a2ui-lifecycle-view
        [snapshot]="state"
        [loadingComponent]="config.a2ui?.loadingComponent"
      />
    } @else {
      <div class="handoff">
        <div
          class="surface-container"
          data-testid="a2ui-activity-surface-host"
          [class.surface-pending]="state.view === 'handoff'"
          [attr.aria-hidden]="state.view === 'handoff'"
        >
          <div
            class="copilot-a2ui-surface-scroll"
            data-testid="a2ui-activity-surface-scroll"
          >
            <copilot-a2ui-surface-outlet
              [operations]="state.operations"
              [agent]="agent()"
              (rendered)="controller.markRendered()"
            />
          </div>
        </div>
        @if (state.view === "handoff") {
          <copilot-a2ui-lifecycle-view
            [snapshot]="state"
            [loadingComponent]="config.a2ui?.loadingComponent"
          />
        }
      </div>
    }
  `,
  styles: `
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
      padding-top: 0.25rem;
      padding-bottom: 0.5rem;
    }
    .handoff {
      position: relative;
    }
    .surface-pending {
      position: absolute;
      inset: 0;
      opacity: 0;
      pointer-events: none;
    }
  `,
})
export class CopilotA2UIActivityRenderer implements ActivityRenderer<unknown> {
  readonly activityType = input.required<string>();
  readonly content = input.required<unknown>();
  readonly message = input.required<ActivityMessage>();
  readonly agent = input<AbstractAgent | undefined>();

  protected readonly config = injectCopilotKitConfig();
  protected readonly controller = new ɵA2UIActivityController({
    ...injectA2UIControllerScheduling(),
    recovery: this.config.a2ui?.recovery,
  });
  protected readonly snapshot = signal<ɵA2UIActivitySnapshot>(
    this.controller.getSnapshot(),
  );

  constructor() {
    const unsubscribe = this.controller.subscribe(() =>
      this.snapshot.set(this.controller.getSnapshot()),
    );
    inject(DestroyRef).onDestroy(() => {
      unsubscribe();
      this.controller.dispose();
    });
    explicitEffect(this.content, (content) =>
      this.controller.setContent(content),
    );
  }
}
