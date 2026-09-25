import { Component, computed, input } from "@angular/core";
import type { DateTimeInputApi } from "@a2ui/web_core/v0_9/basic_catalog";
import { uniqueId, type BasicProps } from "./shared";

@Component({
  selector: "copilot-a2ui-date-time-input",
  template: `
    <div class="field">
      @if (props().label) {
        <label class="label" [for]="inputId">{{ props().label }}</label>
      }
      <input
        class="input"
        [id]="inputId"
        [type]="type()"
        [value]="props().value ?? ''"
        [min]="bound(props().min)"
        [max]="bound(props().max)"
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
  `,
})
export class CopilotA2UIDateTimeInput {
  readonly props = input.required<BasicProps<typeof DateTimeInputApi>>();
  protected readonly inputId = uniqueId("datetime");
  protected readonly type = computed(() => {
    const { enableDate, enableTime } = this.props();
    if (enableDate && !enableTime) return "date";
    if (!enableDate && enableTime) return "time";
    return "datetime-local";
  });

  protected bound(value: unknown): string {
    return typeof value === "string" ? value : "";
  }

  protected update(event: Event): void {
    this.props().setValue((event.target as HTMLInputElement).value);
  }
}
