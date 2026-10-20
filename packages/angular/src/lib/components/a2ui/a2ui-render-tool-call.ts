import { Component, input } from "@angular/core";
import type { AngularToolCall, ToolRenderer } from "../../tools";
import type { RenderA2UIArgs } from "./a2ui-tool-types";

/**
 * @internal
 * Renders nothing for `render_a2ui`. The A2UI middleware streams the whole
 * lifecycle on the `a2ui-surface` activity, so drawing the tool call as well
 * would paint the surface twice. Registering it still keeps a wildcard tool
 * renderer from showing the raw arguments.
 */
@Component({
  selector: "copilot-a2ui-render-tool-call",
  template: "",
})
export class CopilotA2UIRenderToolCall implements ToolRenderer<RenderA2UIArgs> {
  readonly toolCall = input.required<AngularToolCall<RenderA2UIArgs>>();
}
