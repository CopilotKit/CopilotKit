import { Component } from "@angular/core";
import { ColumnApi } from "@a2ui/web_core/v0_9/basic_catalog";
import { CopilotA2UIChild } from "../child";
import { CopilotA2UIBasicComponent } from "./basic-component";
import { mapAlign, mapJustify } from "./shared";

@Component({
  selector: "copilot-a2ui-column",
  imports: [CopilotA2UIChild],
  host: {
    "[style.justify-content]": "mapJustify(props().justify)",
    "[style.align-items]": "mapAlign(props().align)",
  },
  template: `
    @for (child of props().children; track $index) {
      <copilot-a2ui-child [child]="child" />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--a2ui-column-gap, var(--a2ui-spacing-m, 8px));
      width: 100%;
    }
  `,
})
export class CopilotA2UIColumn extends CopilotA2UIBasicComponent<
  typeof ColumnApi
> {
  protected readonly mapJustify = mapJustify;
  protected readonly mapAlign = mapAlign;
}
