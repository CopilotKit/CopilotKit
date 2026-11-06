import { Component, computed, input } from "@angular/core";
import type { AbstractAgent } from "@ag-ui/client";
import type { AngularToolCall, ToolRenderer } from "../../tools";
import { ɵgetRenderedA2UIToolOperations } from "@copilotkit/a2ui-renderer/engine-core";
import { ɵgetA2UIProgressPhase } from "@copilotkit/core";
import { CopilotA2UIProgress } from "./a2ui-progress";
import {
  AGUI_SEND_STATE_SNAPSHOT_TOOL_NAME,
  type RenderA2UIArgs,
} from "./a2ui-tool-types";
import { CopilotA2UISurfaceOutlet } from "./surface-outlet";

@Component({
  selector: "copilot-a2ui-tool-renderer",
  imports: [CopilotA2UIProgress, CopilotA2UISurfaceOutlet],
  host: {
    class: "copilot-a2ui-surface-renderer-layout",
  },
  template: `
    @if (renderedOperations().length > 0) {
      <div
        class="copilot-a2ui-surface-scroll"
        data-testid="a2ui-tool-surface-scroll"
      >
        <copilot-a2ui-surface-outlet
          data-testid="a2ui-tool-surface"
          [operations]="renderedOperations()"
          [agent]="agent()"
        />
      </div>
    } @else if (!isHidden()) {
      <copilot-a2ui-progress [phase]="phase()" [tokens]="tokens()" />
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
  `,
})
export class CopilotA2UIToolRenderer implements ToolRenderer<RenderA2UIArgs> {
  readonly toolCall = input.required<AngularToolCall<RenderA2UIArgs>>();
  readonly agent = input<AbstractAgent | undefined>();

  protected readonly renderedOperations = computed(() =>
    ɵgetRenderedA2UIToolOperations(this.toolCall()),
  );

  protected readonly tokens = computed(() =>
    Math.round(JSON.stringify(this.toolCall().args ?? {}).length / 4),
  );

  protected readonly phase = computed(() =>
    ɵgetA2UIProgressPhase(this.tokens()),
  );

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
}
