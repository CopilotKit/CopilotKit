import { Component, input } from "@angular/core";
import type { RowApi } from "@a2ui/web_core/v0_9/basic_catalog";
import { CopilotA2UIChild } from "../child";
import { mapAlign, mapJustify, type BasicProps } from "./shared";

@Component({
  selector: "copilot-a2ui-row",
  imports: [CopilotA2UIChild],
  template: `
    <div
      class="row"
      [style.justify-content]="mapJustify(props().justify)"
      [style.align-items]="mapAlign(props().align)"
    >
      @for (child of props().children; track $index) {
        <copilot-a2ui-child [child]="child" />
      }
    </div>
  `,
  styles: `
    :host {
      display: contents;
    }
    .row {
      display: flex;
      flex-direction: row;
      width: 100%;
      margin: 0;
      padding: 0;
    }
  `,
})
export class CopilotA2UIRow {
  readonly props = input.required<BasicProps<typeof RowApi>>();
  protected readonly mapJustify = mapJustify;
  protected readonly mapAlign = mapAlign;
}
