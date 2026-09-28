import { Component, computed, input } from "@angular/core";
import type { TextFieldApi } from "@a2ui/web_core/v0_9/basic_catalog";
import { uniqueId, type BasicProps } from "./shared";

@Component({
  selector: "copilot-a2ui-text-field",
  template: `
    <div class="field">
      @if (props().label) {
        <label class="label" [for]="inputId">{{ props().label }}</label>
      }
      @if (props().variant === "longText") {
        <textarea
          class="input"
          [class.invalid]="error()"
          [id]="inputId"
          [value]="props().value ?? ''"
          (input)="update($event)"
        ></textarea>
      } @else {
        <input
          class="input"
          [class.invalid]="error()"
          [id]="inputId"
          [type]="type()"
          [value]="props().value ?? ''"
          (input)="update($event)"
        />
      }
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
      gap: calc(var(--a2ui-spacing-m, 8px) / 2);
      width: 100%;
      margin: var(--a2ui-spacing-m, 8px);
    }
    .label {
      font-size: var(--a2ui-font-size-s, 14px);
      font-weight: bold;
    }
    .input {
      width: 100%;
      padding: var(--a2ui-input-padding, 8px);
      border: 1px solid var(--a2ui-color-border, #ccc);
      border-radius: var(--a2ui-border-radius, 8px);
      box-sizing: border-box;
      background-color: var(--a2ui-color-input, Field);
      color: var(--a2ui-color-on-input, FieldText);
    }
    .invalid {
      border: 1px solid var(--a2ui-color-error, red);
    }
    .error {
      font-size: var(--a2ui-font-size-xs, 12px);
      color: var(--a2ui-color-error, red);
    }
  `,
})
export class CopilotA2UITextField {
  readonly props = input.required<BasicProps<typeof TextFieldApi>>();
  protected readonly inputId = uniqueId("textfield");
  protected readonly error = computed(() => this.props().validationErrors?.[0]);
  protected readonly type = computed(() => {
    switch (this.props().variant) {
      case "number":
        return "number";
      case "obscured":
        return "password";
      default:
        return "text";
    }
  });

  protected update(event: Event): void {
    this.props().setValue(
      (event.target as HTMLInputElement | HTMLTextAreaElement).value,
    );
  }
}
