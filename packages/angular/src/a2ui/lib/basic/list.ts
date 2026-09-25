import { Component, computed, input } from "@angular/core";
import type { ListApi } from "@a2ui/web_core/v0_9/basic_catalog";
import { CopilotA2UIChild } from "../child";
import { mapAlign, type BasicProps } from "./shared";

@Component({
  selector: "copilot-a2ui-list",
  imports: [CopilotA2UIChild],
  template: `
    <div
      class="list"
      [class.horizontal]="horizontal()"
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
    .list {
      display: flex;
      flex-direction: column;
      overflow-x: hidden;
      overflow-y: auto;
      width: 100%;
      margin: 0;
      padding: 0;
    }
    .horizontal {
      flex-direction: row;
      overflow-x: auto;
      overflow-y: hidden;
    }
  `,
})
export class CopilotA2UIList {
  readonly props = input.required<BasicProps<typeof ListApi>>();
  protected readonly mapAlign = mapAlign;
  protected readonly horizontal = computed(
    () => this.props().direction === "horizontal",
  );
}
