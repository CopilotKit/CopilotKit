import { Component } from "@angular/core";
import { DividerApi } from "@a2ui/web_core/v0_9/basic_catalog";
import { CopilotA2UIBasicComponent } from "./basic-component";

@Component({
  selector: "copilot-a2ui-divider",
  host: {
    role: "separator",
    "[class.vertical]": "props().axis === 'vertical'",
  },
  template: "",
  styles: `
    :host {
      display: block;
      width: 100%;
      height: 1px;
      margin: var(--a2ui-spacing-m, 8px) 0;
      border: none;
      background-color: var(--a2ui-color-border, #ccc);
    }
    :host(.vertical) {
      width: 1px;
      height: 100%;
      margin: 0 var(--a2ui-spacing-m, 8px);
    }
  `,
})
export class CopilotA2UIDivider extends CopilotA2UIBasicComponent<
  typeof DividerApi
> {}
