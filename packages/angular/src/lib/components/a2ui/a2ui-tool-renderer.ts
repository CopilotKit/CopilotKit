import {
  CUSTOM_ELEMENTS_SCHEMA,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  viewChild,
} from "@angular/core";
import type { AbstractAgent } from "@ag-ui/client";
import { COPILOT_KIT_CONFIG } from "../../config";
import { CopilotKit } from "../../copilotkit";
import type { AngularToolCall, ToolRenderer } from "../../tools";
import {
  bridgeA2UIAction,
  defineA2UIWebComponentsOnce,
  logA2UIRenderError,
  syncA2UISurface,
  type A2UISurfaceElement,
} from "./a2ui-surface-host";
import { getRenderedA2UIOperations } from "./a2ui-tool-operations";
export {
  AGUI_SEND_STATE_SNAPSHOT_TOOL_NAME,
  RENDER_A2UI_TOOL_NAME,
  RenderA2UIArgsSchema,
  type RenderA2UIArgs,
} from "./a2ui-tool-types";
import {
  AGUI_SEND_STATE_SNAPSHOT_TOOL_NAME,
  type RenderA2UIArgs,
} from "./a2ui-tool-types";

type SkeletonRow = {
  phase: number;
  delay: number;
  segments: Array<
    | { type: "dot" }
    | { type: "spacer" }
    | {
        type: "bar";
        width: number;
        height: number;
        background: string;
        animationDelay?: number;
        opacity?: number;
      }
  >;
};

@Component({
  selector: "copilot-a2ui-tool-renderer",
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (renderedOperations().length > 0) {
      <div
        class="copilot-a2ui-surface-scroll"
        data-testid="a2ui-tool-surface-scroll"
      >
        <cpk-a2ui-surface
          #surface
          data-testid="a2ui-tool-surface"
          (a2ui-action)="handleAction($event)"
          (a2ui-error)="handleError($event)"
        ></cpk-a2ui-surface>
      </div>
    } @else if (!isHidden()) {
      <div class="copilot-a2ui-progress" data-testid="a2ui-progress">
        <div class="copilot-a2ui-progress-card">
          <div class="copilot-a2ui-topbar">
            <div class="copilot-a2ui-dot-group">
              <span class="copilot-a2ui-dot"></span>
              <span class="copilot-a2ui-dot"></span>
              <span class="copilot-a2ui-dot"></span>
            </div>
            <span
              class="copilot-a2ui-bar"
              [style.width.px]="64"
              [style.height.px]="6"
              [style.background-color]="'#e4e4e7'"
              [style.opacity]="phase() >= 1 ? 1 : 0.4"
            ></span>
          </div>

          <div class="copilot-a2ui-lines">
            @for (row of rows; track $index) {
              <div
                class="copilot-a2ui-row"
                [style.opacity]="phase() >= row.phase ? 1 : 0"
                [style.transition-delay.s]="row.delay"
              >
                @for (segment of row.segments; track $index) {
                  @switch (segment.type) {
                    @case ("dot") {
                      <span class="copilot-a2ui-dot"></span>
                    }
                    @case ("spacer") {
                      <span class="copilot-a2ui-spacer"></span>
                    }
                    @case ("bar") {
                      <span
                        class="copilot-a2ui-bar"
                        [style.width.px]="segment.width"
                        [style.height.px]="segment.height"
                        [style.background-color]="segment.background"
                        [style.animation-delay.s]="segment.animationDelay ?? 0"
                        [style.opacity]="segment.opacity ?? null"
                      ></span>
                    }
                  }
                }
              </div>
            }
          </div>

          <div class="copilot-a2ui-shimmer"></div>
        </div>

        <div class="copilot-a2ui-label">
          <span>Building interface</span>
          @if (tokens() > 0) {
            <span class="copilot-a2ui-token-count">
              ~{{ tokens().toLocaleString() }} tokens
            </span>
          }
        </div>
      </div>
    }
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

      .copilot-a2ui-progress {
        margin: 12px 0;
        max-width: 320px;
      }

      .copilot-a2ui-progress-card {
        position: relative;
        overflow: hidden;
        border-radius: 12px;
        border: 1px solid rgba(228, 228, 231, 0.8);
        background-color: #fff;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
        padding: 16px 18px 14px;
      }

      .copilot-a2ui-topbar,
      .copilot-a2ui-row,
      .copilot-a2ui-label,
      .copilot-a2ui-dot-group {
        display: flex;
        align-items: center;
      }

      .copilot-a2ui-topbar {
        gap: 8px;
        margin-bottom: 12px;
      }

      .copilot-a2ui-dot-group,
      .copilot-a2ui-row {
        gap: 6px;
      }

      .copilot-a2ui-lines {
        display: grid;
        gap: 7px;
      }

      .copilot-a2ui-row {
        transition-property: opacity;
        transition-duration: 0.4s;
      }

      .copilot-a2ui-dot {
        width: 7px;
        height: 7px;
        border-radius: 9999px;
        background-color: #d4d4d8;
        flex-shrink: 0;
      }

      .copilot-a2ui-spacer {
        width: 12px;
        flex: 0 0 12px;
      }

      .copilot-a2ui-bar {
        display: inline-flex;
        border-radius: 9999px;
        animation: copilot-a2ui-fade 2.4s ease-in-out infinite;
      }

      .copilot-a2ui-shimmer {
        pointer-events: none;
        position: absolute;
        inset: 0;
        background: linear-gradient(
          105deg,
          transparent 0%,
          transparent 40%,
          rgba(255, 255, 255, 0.6) 50%,
          transparent 60%,
          transparent 100%
        );
        background-size: 250% 100%;
        animation: copilot-a2ui-sweep 3s ease-in-out infinite;
      }

      .copilot-a2ui-label {
        justify-content: center;
        gap: 8px;
        margin-top: 8px;
        font-size: 12px;
        color: #a1a1aa;
      }

      .copilot-a2ui-token-count {
        font-size: 11px;
        color: #d4d4d8;
        font-variant-numeric: tabular-nums;
      }

      @keyframes copilot-a2ui-fade {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.5;
        }
      }

      @keyframes copilot-a2ui-sweep {
        0% {
          background-position: 250% 0;
        }
        100% {
          background-position: -250% 0;
        }
      }
    `,
  ],
})
export class CopilotA2UIToolRenderer implements ToolRenderer<RenderA2UIArgs> {
  readonly toolCall = input.required<AngularToolCall<RenderA2UIArgs>>();
  readonly agent = input<AbstractAgent | undefined>();

  private readonly surfaceRef = viewChild<
    unknown,
    ElementRef<A2UISurfaceElement>
  >("surface", { read: ElementRef });
  private readonly config = inject(COPILOT_KIT_CONFIG, { optional: true });
  private readonly copilotKit = inject(CopilotKit, { optional: true });
  private readonly destroyRef = inject(DestroyRef);
  private destroyed = false;

  protected readonly renderedOperations = computed(() =>
    getRenderedA2UIOperations(this.toolCall()),
  );

  protected readonly tokens = computed(() =>
    Math.round(JSON.stringify(this.toolCall().args ?? {}).length / 4),
  );

  protected readonly phase = computed(() => {
    const tokens = this.tokens();
    if (tokens < 50) return 0;
    if (tokens < 200) return 1;
    if (tokens < 400) return 2;
    return 3;
  });

  protected readonly isHidden = computed(() => {
    const toolCall = this.toolCall();
    if (toolCall.status === "complete") {
      return this.renderedOperations().length === 0;
    }

    if (toolCall.name === AGUI_SEND_STATE_SNAPSHOT_TOOL_NAME) {
      return false;
    }

    const { items, components } = toolCall.args;
    if (Array.isArray(items) && items.length > 0) return true;
    return Array.isArray(components) && components.length > 2;
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
    });

    this.ensureDefined();

    effect(() => {
      this.renderedOperations();
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
    syncA2UISurface(element, this.renderedOperations(), this.config);
  }

  protected handleError(event: Event): void {
    logA2UIRenderError(event);
  }

  protected async handleAction(event: Event): Promise<void> {
    await bridgeA2UIAction(
      this.copilotKit,
      this.agent(),
      (event as CustomEvent).detail,
    );
  }

  protected readonly rows: SkeletonRow[] = [
    {
      phase: 0,
      delay: 0,
      segments: [
        {
          type: "bar",
          width: 36,
          height: 7,
          background: "rgba(147,197,253,0.7)",
          animationDelay: 0,
        },
        {
          type: "bar",
          width: 80,
          height: 7,
          background: "rgba(219,234,254,0.8)",
          animationDelay: 0.2,
        },
      ],
    },
    {
      phase: 0,
      delay: 0.1,
      segments: [
        { type: "spacer" },
        { type: "dot" },
        {
          type: "bar",
          width: 100,
          height: 7,
          background: "rgba(24,24,27,0.2)",
          animationDelay: 0.3,
        },
      ],
    },
    {
      phase: 1,
      delay: 0.15,
      segments: [
        { type: "spacer" },
        {
          type: "bar",
          width: 48,
          height: 7,
          background: "rgba(24,24,27,0.15)",
          animationDelay: 0.1,
        },
        {
          type: "bar",
          width: 40,
          height: 7,
          background: "rgba(153,246,228,0.6)",
          animationDelay: 0.5,
        },
        {
          type: "bar",
          width: 56,
          height: 7,
          background: "rgba(147,197,253,0.6)",
          animationDelay: 0.3,
        },
      ],
    },
    {
      phase: 1,
      delay: 0.2,
      segments: [
        { type: "spacer" },
        { type: "dot" },
        {
          type: "bar",
          width: 60,
          height: 7,
          background: "rgba(24,24,27,0.15)",
          animationDelay: 0.4,
        },
      ],
    },
    {
      phase: 2,
      delay: 0.25,
      segments: [
        {
          type: "bar",
          width: 40,
          height: 7,
          background: "rgba(153,246,228,0.5)",
          animationDelay: 0.2,
        },
        { type: "dot" },
        {
          type: "bar",
          width: 48,
          height: 7,
          background: "rgba(24,24,27,0.15)",
          animationDelay: 0.6,
        },
        {
          type: "bar",
          width: 64,
          height: 7,
          background: "rgba(147,197,253,0.5)",
          animationDelay: 0.1,
        },
      ],
    },
    {
      phase: 2,
      delay: 0.3,
      segments: [
        {
          type: "bar",
          width: 36,
          height: 7,
          background: "rgba(147,197,253,0.6)",
          animationDelay: 0.5,
        },
        {
          type: "bar",
          width: 36,
          height: 7,
          background: "rgba(24,24,27,0.12)",
          animationDelay: 0.7,
        },
      ],
    },
    {
      phase: 3,
      delay: 0.35,
      segments: [
        { type: "dot" },
        {
          type: "bar",
          width: 44,
          height: 7,
          background: "rgba(24,24,27,0.18)",
          animationDelay: 0.3,
        },
        { type: "dot" },
        {
          type: "bar",
          width: 56,
          height: 7,
          background: "rgba(153,246,228,0.5)",
          animationDelay: 0.8,
        },
        {
          type: "bar",
          width: 48,
          height: 7,
          background: "rgba(147,197,253,0.5)",
          animationDelay: 0.4,
        },
      ],
    },
  ];
}
