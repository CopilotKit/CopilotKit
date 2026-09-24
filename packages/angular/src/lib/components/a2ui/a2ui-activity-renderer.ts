import {
  Component,
  NgZone,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  input,
  signal,
} from "@angular/core";
import { isPlatformBrowser } from "@angular/common";
import type { AbstractAgent, ActivityMessage } from "@ag-ui/client";
import type { ActivityRenderer } from "../../activity-renderer";
import { injectCopilotKitConfig } from "../../config";
import {
  getA2UIOperations,
  surfaceHasRenderableContent,
} from "./a2ui-surface-host";
import { CopilotA2UIRecovery } from "./a2ui-recovery";
import { CopilotA2UISurfaceOutlet } from "./surface-outlet";

@Component({
  selector: "copilot-a2ui-activity-renderer",
  imports: [CopilotA2UIRecovery, CopilotA2UISurfaceOutlet],
  host: {
    class: "copilot-a2ui-surface-renderer-layout",
  },
  template: `
    @if (hasOperations()) {
      <div class="handoff">
        <div
          class="surface-container"
          data-testid="a2ui-activity-surface-host"
          [class.surface-pending]="!surfaceReady()"
          [attr.aria-hidden]="!surfaceReady()"
        >
          <div
            class="copilot-a2ui-surface-scroll"
            data-testid="a2ui-activity-surface-scroll"
          >
            <copilot-a2ui-surface-outlet
              [operations]="operations()"
              [agent]="agent()"
              (rendered)="handleRendered()"
            />
          </div>
        </div>
        @if (!surfaceReady()) {
          <copilot-a2ui-recovery
            [content]="loaderContent()"
            [options]="config.a2ui?.recovery"
          />
        }
      </div>
    } @else {
      <copilot-a2ui-recovery
        [content]="content()"
        [options]="config.a2ui?.recovery"
      />
    }
  `,
  styles: `
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
  private readonly platformId = inject(PLATFORM_ID);
  private readonly zone = inject(NgZone);
  protected readonly operations = computed(() =>
    getA2UIOperations(this.content()),
  );
  protected readonly hasOperations = computed(
    () => this.operations().length > 0,
  );
  protected readonly surfaceReady = signal(false);
  protected readonly loaderContent = signal<unknown>({ status: "building" });

  constructor() {
    effect(() => {
      const content = this.content();
      if (getA2UIOperations(content).length === 0) {
        this.loaderContent.set(content);
      }
    });
    effect((onCleanup) => {
      const hasOperations = this.hasOperations();
      if (!hasOperations) {
        this.surfaceReady.set(false);
        return;
      }
      this.surfaceReady.set(false);
      if (!isPlatformBrowser(this.platformId)) return;
      const timeout = this.zone.runOutsideAngular(() =>
        globalThis.setTimeout(
          () => this.zone.run(() => this.surfaceReady.set(true)),
          8000,
        ),
      );
      onCleanup(() => globalThis.clearTimeout(timeout));
    });
  }

  protected handleRendered(): void {
    if (this.surfaceReady()) return;
    if (!surfaceHasRenderableContent(this.operations())) return;
    const reveal = () => this.zone.run(() => this.surfaceReady.set(true));
    if (
      isPlatformBrowser(this.platformId) &&
      typeof globalThis.requestAnimationFrame === "function"
    ) {
      globalThis.requestAnimationFrame(reveal);
    } else {
      reveal();
    }
  }
}
