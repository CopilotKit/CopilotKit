import { Component, input, Input } from "@angular/core";
import { CommonModule } from "@angular/common";
import { AngularToolCall, ToolRenderer } from "@copilotkitnext/angular";

@Component({
  selector: "wildcard-tool-render",
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      style="padding: 12px; margin: 8px 0; background-color: #f5f5f5; border-radius: 8px; border: 1px solid #ddd;"
    >
      <div style="font-weight: bold; margin-bottom: 4px;">
        🔧 Tool Execution
      </div>
      <div style="font-size: 14px; color: #666;">
        <pre>{{ argsJson }}</pre>
      </div>
      <div style="margin-top: 8px; color: #333;">
        Output: {{ toolCall().result }}
      </div>
    </div>
  `,
})
export class WildcardToolRenderComponent implements ToolRenderer {
  readonly toolCall = input.required<AngularToolCall<any>>();

  get argsJson() {
    return JSON.stringify(this.toolCall().args, null, 2);
  }
}
