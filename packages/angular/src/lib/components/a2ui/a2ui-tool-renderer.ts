import { Component, computed, input } from "@angular/core";
import type { AbstractAgent } from "@ag-ui/client";
import type { AngularToolCall, ToolRenderer } from "../../tools";
import { getRenderedA2UIOperations } from "./a2ui-tool-operations";
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
})
export class CopilotA2UIToolRenderer implements ToolRenderer<RenderA2UIArgs> {
  readonly toolCall = input.required<AngularToolCall<RenderA2UIArgs>>();
  readonly agent = input<AbstractAgent | undefined>();

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
}
