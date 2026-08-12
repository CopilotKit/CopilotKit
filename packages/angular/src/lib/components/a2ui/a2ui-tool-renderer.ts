import {
  CUSTOM_ELEMENTS_SCHEMA,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
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
  connectA2UISurface,
  logA2UIRenderError,
  type A2UISurfaceElement,
} from "./a2ui-surface-host";
import { getRenderedA2UIOperations } from "./a2ui-tool-operations";
import { CopilotA2UIProgress } from "./a2ui-progress";
import {
  AGUI_SEND_STATE_SNAPSHOT_TOOL_NAME,
  type RenderA2UIArgs,
} from "./a2ui-tool-types";

@Component({
  selector: "copilot-a2ui-tool-renderer",
  imports: [CopilotA2UIProgress],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  host: {
    class: "copilot-a2ui-surface-renderer-layout",
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (renderedOperations().length > 0) {
      <div
        class="copilot-a2ui-surface-scroll"
        data-testid="a2ui-tool-surface-scroll"
      >
        <cpk-a2ui-surface
          #surface
          class="copilot-a2ui-surface-scroll-surface"
          data-testid="a2ui-tool-surface"
          (a2ui-action)="handleAction($event)"
          (a2ui-error)="handleError($event)"
        ></cpk-a2ui-surface>
      </div>
    } @else if (!isHidden()) {
      <copilot-a2ui-progress [phase]="phase()" [tokens]="tokens()" />
    }
  `,
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
    connectA2UISurface({
      surfaceRef: this.surfaceRef,
      operations: this.renderedOperations,
      config: this.config,
    });
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
}
