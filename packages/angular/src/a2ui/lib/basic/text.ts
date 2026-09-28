import { Component, input } from "@angular/core";
import type { TextApi } from "@a2ui/web_core/v0_9/basic_catalog";
import type { BasicProps } from "./shared";

@Component({
  selector: "copilot-a2ui-text",
  template: `
    @switch (props().variant) {
      @case ("h1") {
        <h1 class="text">{{ props().text }}</h1>
      }
      @case ("h2") {
        <h2 class="text">{{ props().text }}</h2>
      }
      @case ("h3") {
        <h3 class="text">{{ props().text }}</h3>
      }
      @case ("h4") {
        <h4 class="text">{{ props().text }}</h4>
      }
      @case ("h5") {
        <h5 class="text">{{ props().text }}</h5>
      }
      @case ("caption") {
        <small class="text caption">{{ props().text }}</small>
      }
      @default {
        <span class="text">{{ props().text }}</span>
      }
    }
  `,
  styles: `
    :host {
      display: contents;
    }
    .text {
      display: inline-block;
      margin: var(--a2ui-spacing-m, 8px);
      box-sizing: border-box;
    }
    .caption {
      color: var(--a2ui-color-muted, #666);
      text-align: left;
    }
  `,
})
export class CopilotA2UIText {
  readonly props = input.required<BasicProps<typeof TextApi>>();
}
