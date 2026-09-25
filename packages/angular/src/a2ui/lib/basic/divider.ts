import { Component, input } from "@angular/core";
import type { DividerApi } from "@a2ui/web_core/v0_9/basic_catalog";
import type { BasicProps } from "./shared";

@Component({
  selector: "copilot-a2ui-divider",
  template: `
    <div
      class="divider"
      role="separator"
      [class.vertical]="props().axis === 'vertical'"
    ></div>
  `,
  styles: `
    :host {
      display: contents;
    }
    .divider {
      width: 100%;
      height: 1px;
      margin: var(--a2ui-spacing-m, 8px);
      border: none;
      background-color: var(--a2ui-color-border, #ccc);
    }
    .vertical {
      width: 1px;
      height: 100%;
    }
  `,
})
export class CopilotA2UIDivider {
  readonly props = input.required<BasicProps<typeof DividerApi>>();
}
