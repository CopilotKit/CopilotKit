import {
  CUSTOM_ELEMENTS_SCHEMA,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  NgZone,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from "@angular/core";
import { isPlatformBrowser } from "@angular/common";
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
import { CopilotA2UIRecovery } from "./a2ui-recovery";

@Component({
  selector: "copilot-a2ui-activity-renderer",
  imports: [CopilotA2UIRecovery],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  host: {
    class: "copilot-a2ui-surface-renderer-layout",
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
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
            <cpk-a2ui-surface
              #surface
              class="copilot-a2ui-surface-scroll-surface"
              (a2ui-action)="handleAction($event)"
              (a2ui-error)="handleError($event)"
            ></cpk-a2ui-surface>
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

  private readonly surfaceRef = viewChild<
    unknown,
    ElementRef<A2UISurfaceElement>
  >("surface", { read: ElementRef });

  private readonly copilotKit = inject(CopilotKit);
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

  private readonly markSurfaceReady = (): void => {
    if (this.surfaceReady()) return;
    const reveal = () => this.zone.run(() => this.surfaceReady.set(true));
    if (
      isPlatformBrowser(this.platformId) &&
      typeof globalThis.requestAnimationFrame === "function"
    ) {
      globalThis.requestAnimationFrame(reveal);
    } else {
      reveal();
    }
  };

  constructor() {
    connectA2UISurface({
      surfaceRef: this.surfaceRef,
      operations: this.operations,
      config: this.config,
      onReady: this.markSurfaceReady,
    });
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
