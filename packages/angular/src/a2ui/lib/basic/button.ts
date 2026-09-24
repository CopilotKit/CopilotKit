import { Component, input } from "@angular/core";
import type { ButtonApi } from "@a2ui/web_core/v0_9/basic_catalog";
import { CopilotA2UIChild } from "../child";
import type { BasicProps } from "./shared";

@Component({
  selector: "copilot-a2ui-button",
  imports: [CopilotA2UIChild],
  template: `
    <button
      type="button"
      class="button"
      [class.primary]="props().variant === 'primary'"
      [class.borderless]="props().variant === 'borderless'"
      [disabled]="props().isValid === false"
      (click)="props().action?.()"
    >
      <copilot-a2ui-child [child]="props().child" />
    </button>
  `,
  styles: `
    :host {
      display: contents;
    }
    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin: var(--a2ui-spacing-m, 8px);
      padding: var(--a2ui-button-padding, 8px 16px);
      border: 1px solid var(--a2ui-color-border, #ccc);
      border-radius: var(--a2ui-button-border-radius, 4px);
      box-sizing: border-box;
      background-color: var(--a2ui-color-surface, #fff);
      color: inherit;
      cursor: pointer;
    }
    .primary {
      background-color: var(
        --a2ui-color-primary,
        var(--a2ui-primary-color, #007bff)
      );
      color: var(--a2ui-color-on-primary, #fff);
    }
    .borderless {
      border: none;
      background-color: transparent;
    }
  `,
})
export class CopilotA2UIButton {
  readonly props = input.required<BasicProps<typeof ButtonApi>>();
}
