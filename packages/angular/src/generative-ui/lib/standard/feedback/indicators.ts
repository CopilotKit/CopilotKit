import { Component, computed, input, signal } from "@angular/core";
import {
  backgroundColor,
  borderColor,
  radius,
  spacing,
  textColor,
  textFont,
} from "@copilotkit/shared/generative-ui";
import type { StyleMap } from "../style";
import { BUTTON_RESET, injectFeedbackStyles } from "./styles";

/** A spinning ring. It is decoration: the caller names the status. */
@Component({
  selector: "span[copilotGenerativeUIPulseIndicator]",
  template: `
    <span
      data-a2ui-motion=""
      data-a2ui-pulse=""
      style="position: absolute; inset: 0; border-radius: 9999px"
      [style.background]="pulseBackground()"
      [style.animation]="animation()"
      [style.--a2ui-pulse-scale]="endScale()"
      [style.--a2ui-pulse-opacity]="startOpacity()"
    ></span>
    <span
      style="position: absolute; inset: 0; border-radius: 9999px"
      [style.background]="dotColor()"
    ></span>
  `,
  host: {
    "data-a2ui-std": "",
    "[attr.role]": "label() !== undefined ? 'img' : null",
    "[attr.aria-label]": "label()",
    "[attr.aria-hidden]": "label() === undefined ? 'true' : null",
    style: "position:relative;display:inline-block;flex:none",
    "[style.width.px]": "size() ?? 12",
    "[style.height.px]": "size() ?? 12",
  },
})
export class CopilotGenerativeUIPulseIndicator {
  readonly label = input<string>();
  readonly color = input<string>();
  readonly size = input<number>();
  readonly pulseColor = input<string>();
  readonly duration = input<number>();
  readonly endScale = input<number>();
  readonly startOpacity = input<number>();

  protected readonly dotColor = computed(() =>
    textColor(this.color() ?? "success"),
  );
  protected readonly pulseBackground = computed(
    () => textColor(this.pulseColor()) ?? this.dotColor(),
  );
  protected readonly animation = computed(
    () => `a2ui-pulse ${this.duration() ?? 1500}ms ease-out infinite`,
  );

  constructor() {
    injectFeedbackStyles();
  }
}

/**
 * A native toggle button. Click, Enter and Space flip it, and
 * `aria-pressed` tells a screen reader which side shows.
 */
@Component({
  selector: "button[copilotGenerativeUIFlashcardFlip]",
  template: `
    <span [style]="faceStyle">{{ flipped() ? back() : front() }}</span>
    @if (hint() !== undefined && !flipped()) {
      <span [style]="hintStyle">{{ hint() }}</span>
    }
  `,
  host: {
    type: "button",
    "data-a2ui-std": "",
    "data-a2ui-feedback-button": "",
    "[attr.aria-pressed]": "flipped()",
    "[style]": "style()",
    "(click)": "flipped.set(!flipped())",
  },
})
export class CopilotGenerativeUIFlashcardFlip {
  readonly front = input<string>();
  readonly back = input<string>();
  readonly hint = input<string>();

  protected readonly flipped = signal(false);
  protected readonly faceStyle: StyleMap = {
    ...textFont("lg"),
    "font-weight": 600,
  };
  protected readonly hintStyle: StyleMap = {
    ...textFont("sm"),
    color: textColor("tertiary"),
  };
  protected readonly style = computed<StyleMap>(() => ({
    ...BUTTON_RESET,
    display: "flex",
    "flex-direction": "column",
    "align-items": "center",
    "justify-content": "center",
    gap: spacing(2),
    "min-height": "140px",
    width: "100%",
    padding: spacing(5),
    "box-sizing": "border-box",
    "text-align": "center",
    border: `1px solid ${borderColor("default")}`,
    "border-radius": radius("xl"),
    background: backgroundColor(
      this.flipped() ? "surface-secondary" : "surface",
    ),
    color: textColor("default"),
  }));

  constructor() {
    injectFeedbackStyles();
  }
}
