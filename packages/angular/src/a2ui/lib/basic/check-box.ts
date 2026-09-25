import { Component, computed, input } from "@angular/core";
import type { CheckBoxApi } from "@a2ui/web_core/v0_9/basic_catalog";
import { uniqueId, type BasicProps } from "./shared";

@Component({
  selector: "copilot-a2ui-check-box",
  template: `
    <div class="field">
      <div class="control">
        <input
          type="checkbox"
          class="checkbox"
          [class.invalid]="error()"
          [id]="inputId"
          [checked]="!!props().value"
          (change)="update($event)"
        />
        @if (props().label) {
          <label class="label" [class.invalid]="error()" [for]="inputId">
            {{ props().label }}
          </label>
        }
      </div>
      @if (error(); as error) {
        <span class="error">{{ error }}</span>
      }
    </div>
  `,
  styles: `
    :host {
      display: contents;
    }
    .field {
      display: flex;
      flex-direction: column;
      margin: var(--a2ui-spacing-m, 8px);
    }
    .control {
      display: flex;
      align-items: center;
      gap: var(--a2ui-spacing-m, 8px);
    }
    .checkbox {
      outline: none;
      cursor: pointer;
    }
    .checkbox.invalid {
      outline: 1px solid var(--a2ui-color-error, red);
    }
    .label {
      color: inherit;
      cursor: pointer;
    }
    .label.invalid {
      color: var(--a2ui-color-error, red);
    }
    .error {
      margin-top: 4px;
      font-size: var(--a2ui-font-size-xs, 12px);
      color: var(--a2ui-color-error, red);
    }
  `,
})
export class CopilotA2UICheckBox {
  readonly props = input.required<BasicProps<typeof CheckBoxApi>>();
  protected readonly inputId = uniqueId("checkbox");
  protected readonly error = computed(() => this.props().validationErrors?.[0]);

  protected update(event: Event): void {
    this.props().setValue((event.target as HTMLInputElement).checked);
  }
}
