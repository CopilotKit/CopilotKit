import { Component, input } from "@angular/core";
import type { CardApi } from "@a2ui/web_core/v0_9/basic_catalog";
import { CopilotA2UIChild } from "../child";
import type { BasicProps } from "./shared";

@Component({
  selector: "copilot-a2ui-card",
  imports: [CopilotA2UIChild],
  template: `
    <div class="card">
      <copilot-a2ui-child [child]="props().child" />
    </div>
  `,
  styles: `
    :host {
      display: contents;
    }
    .card {
      width: 100%;
      margin: var(--a2ui-spacing-m, 8px);
      padding: var(--a2ui-card-padding, 16px);
      border: 1px solid var(--a2ui-color-border, #ccc);
      border-radius: var(--a2ui-border-radius, 8px);
      box-sizing: border-box;
      background-color: var(--a2ui-color-surface, #fff);
      box-shadow: var(--a2ui-card-shadow, 0 2px 4px rgba(0, 0, 0, 0.1));
    }
  `,
})
export class CopilotA2UICard {
  readonly props = input.required<BasicProps<typeof CardApi>>();
}
