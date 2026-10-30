import { Component, computed, input } from "@angular/core";
import {
  FONT_WEIGHT,
  spacing,
  textColor,
  textFont,
} from "@copilotkit/shared/generative-ui";
import type { sliderSchema } from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import type { StyleMap } from "../style";
import {
  CHECK_ERROR,
  CopilotGenerativeUIControl,
  fieldStyle,
  uniqueId,
} from "./control";

type SliderProps = z.output<typeof sliderSchema>;
type SliderMark = NonNullable<SliderProps["marks"]>[number];

/** A range slider for a number between `min` and `max`. */
@Component({
  selector: "div[copilotGenerativeUISlider]",
  template: `
    <div [style]="headerStyle">
      @if (label(); as label) {
        <label [attr.for]="id" [style]="headerLabelStyle">{{ label }}</label>
      } @else {
        <span></span>
      }
      <span style="font-weight: 600; font-variant-numeric: tabular-nums">
        @if (showValue()) {
          {{ valueText() }}
        }
      </span>
    </div>
    <input
      [id]="id"
      type="range"
      class="a2ui-std-range"
      data-a2ui-input
      [attr.name]="name() ?? null"
      [attr.aria-label]="ariaLabel()"
      [attr.aria-description]="control()['aria-description'] ?? null"
      [attr.aria-valuetext]="unit() ? valueText() : null"
      [attr.min]="minValue()"
      [attr.max]="maxValue()"
      [attr.step]="stepValue()"
      [disabled]="disabled() ?? false"
      [value]="current()"
      [attr.list]="listId()"
      (input)="onInput($event)"
    />
    @if (marks().length > 0) {
      <datalist [id]="dataListId">
        @for (mark of marks(); track mark.value) {
          <option [value]="mark.value" [attr.label]="mark.label ?? null"></option>
        }
      </datalist>
      <div aria-hidden="true" [style]="marksStyle">
        @for (mark of marks(); track mark.value) {
          <span>{{ mark.label ?? mark.value }}</span>
        }
      </div>
    }
    ${CHECK_ERROR}
  `,
  host: {
    "[attr.aria-hidden]": "wrapper()['aria-hidden'] ? 'true' : null",
    "[attr.aria-live]": "wrapper()['aria-live'] ?? null",
    "[style]": "hostStyle()",
  },
})
export class CopilotGenerativeUISlider extends CopilotGenerativeUIControl<number> {
  readonly min = input<number>();
  readonly max = input<number>();
  readonly step = input<number>();
  readonly steps = input<number>();
  readonly label = input<string>();
  readonly weight = input<number>();
  readonly unit = input<string>();
  readonly marks = input<SliderMark[], unknown>([], {
    transform: (value: unknown) =>
      Array.isArray(value) ? (value as SliderMark[]) : [],
  });
  readonly sliderStyle = input<SliderProps["sliderStyle"]>();

  protected readonly id = uniqueId("a2ui-slider");
  protected readonly dataListId = uniqueId("a2ui-marks");
  protected readonly minValue = computed(() => this.min() ?? 0);
  protected readonly maxValue = computed(() => this.max() ?? 100);
  protected readonly current = computed(() => this.value() ?? this.minValue());
  protected readonly stepValue = computed(() => {
    const steps = this.steps();
    return steps
      ? (this.maxValue() - this.minValue()) / steps
      : (this.step() ?? 1);
  });
  protected readonly valueText = computed(() => {
    const unit = this.unit();
    return unit ? `${this.current()} ${unit}` : `${this.current()}`;
  });
  protected readonly showValue = computed(() =>
    Boolean(this.label() || this.unit()),
  );
  protected readonly listId = computed(() =>
    this.sliderStyle() === "discrete" && this.marks().length > 0
      ? this.dataListId
      : null,
  );
  protected readonly ariaLabel = computed(
    () =>
      this.control()["aria-label"] ??
      (this.label() ? null : (this.name() ?? null)),
  );
  protected readonly hostStyle = computed(() => fieldStyle(this.weight()));
  protected readonly headerStyle: StyleMap = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing(2),
    ...textFont("sm"),
  };
  protected readonly headerLabelStyle: StyleMap = {
    fontWeight: FONT_WEIGHT.medium,
    color: textColor("secondary"),
  };
  protected readonly marksStyle: StyleMap = {
    display: "flex",
    justifyContent: "space-between",
    gap: spacing(2),
    fontSize: ".875em",
    lineHeight: 1.3,
    color: textColor("secondary"),
  };

  protected onInput(event: Event) {
    this.setValue(Number((event.target as HTMLInputElement).value));
  }
}
