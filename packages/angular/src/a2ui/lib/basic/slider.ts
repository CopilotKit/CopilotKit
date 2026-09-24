import { Component, input } from "@angular/core";
import type { SliderApi } from "@a2ui/web_core/v0_9/basic_catalog";
import { uniqueId, type BasicProps } from "./shared";

@Component({
  selector: "copilot-a2ui-slider",
  template: `
    <div class="field">
      <div class="header">
        @if (props().label) {
          <label class="label" [for]="inputId">{{ props().label }}</label>
        }
        <span class="value">{{ props().value }}</span>
      </div>
      <input
        type="range"
        class="range"
        [id]="inputId"
        [min]="props().min ?? 0"
        [max]="props().max"
        [value]="props().value ?? 0"
        (input)="update($event)"
      />
    </div>
  `,
  styles: `
    :host {
      display: contents;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: calc(var(--a2ui-spacing-m, 8px) / 2);
      width: 100%;
      margin: var(--a2ui-spacing-m, 8px);
    }
    .header {
      display: flex;
      justify-content: space-between;
    }
    .label {
      font-size: var(--a2ui-font-size-s, 14px);
      font-weight: bold;
    }
    .value {
      font-size: var(--a2ui-font-size-xs, 12px);
      color: var(--a2ui-color-muted, #666);
    }
    .range {
      width: 100%;
      cursor: pointer;
    }
  `,
})
export class CopilotA2UISlider {
  readonly props = input.required<BasicProps<typeof SliderApi>>();
  protected readonly inputId = uniqueId("slider");

  protected update(event: Event): void {
    this.props().setValue(Number((event.target as HTMLInputElement).value));
  }
}
