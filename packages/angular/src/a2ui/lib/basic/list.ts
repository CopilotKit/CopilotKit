import { Component, computed } from "@angular/core";
import { ListApi } from "@a2ui/web_core/v0_9/basic_catalog";
import { CopilotA2UIChild } from "../child";
import { CopilotA2UIBasicComponent } from "./basic-component";
import { mapAlign } from "./shared";

@Component({
  selector: "copilot-a2ui-list",
  imports: [CopilotA2UIChild],
  host: {
    "[class.horizontal]": "horizontal()",
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
      gap: var(--a2ui-list-gap, var(--a2ui-spacing-m, 8px));
      overflow-x: hidden;
      overflow-y: auto;
      width: 100%;
    }
    :host(.horizontal) {
      flex-direction: row;
      overflow-x: auto;
      overflow-y: hidden;
    }
  `,
})
export class CopilotA2UIList extends CopilotA2UIBasicComponent<typeof ListApi> {
  protected readonly mapAlign = mapAlign;
  protected readonly horizontal = computed(
    () => this.props().direction === "horizontal",
  );
}
