import {
  Directive,
  computed,
  inject,
  input,
  model,
  output,
} from "@angular/core";
import {
  FONT_WEIGHT,
  backgroundColor,
  borderColor,
  checkMessageStyle,
  radius,
  spacing,
  textColor,
  textFont,
} from "@copilotkit/shared/generative-ui";
import type {
  InputOptionList,
  InputSize,
  ResolvedChecks,
} from "@copilotkit/shared/generative-ui";
import { controlAria, wrapperAria } from "@copilotkit/core/generative-ui";
import { injectGenerativeUIAccessibility } from "../../node-context";
import { GenerativeUIStyles } from "../../styles";
import { createChecksState } from "../checks";
import type { GenerativeUIValidationError } from "../checks";
import { px } from "../style";
import type { StyleMap } from "../style";

let nextId = 0;
/** A document-unique id for a control and its label. */
export const uniqueId = (prefix: string) => `${prefix}-${++nextId}`;

/*
 * Inputs (size xl) are 40px tall, with about 18px side padding and 16px
 * text. Buttons (size lg) are 36px tall pills, with 16px side padding,
 * 14px/500 text and a 6px gap to the icon.
 */
export const HEIGHT: Record<InputSize, number> = {
  sm: 28,
  md: 32,
  lg: 36,
  xl: 40,
};
/** Control text in em of the host size (13/14/14/16px at a 16px base). */
export const FONT_SIZE: Record<InputSize, string> = {
  sm: ".8125em",
  md: ".875em",
  lg: ".875em",
  xl: "1em",
};
export const PAD_X: Record<InputSize, number> = {
  sm: 10,
  md: 12,
  lg: 12,
  xl: 18,
};

/** Text inputs have a slightly stronger hairline than cards. */
const CONTROL_BORDER = "var(--a2ui-color-border-control, rgba(0, 0, 0, 0.15))";

/** A value as input text. `undefined` and `null` give an empty string. */
export const asText = (value: unknown) =>
  value === undefined || value === null ? "" : String(value);

export function normalizeOptions(options: InputOptionList) {
  const list = options ?? [];
  return list.map((option) =>
    typeof option === "string"
      ? { value: option, label: option, description: undefined }
      : {
          value: option.value,
          label: option.label ?? option.value,
          description: option.description,
        },
  );
}

export function controlStyle(
  props: {
    size?: InputSize;
    pill?: boolean;
    invalid?: boolean;
    disabled?: boolean;
  },
  defaultSize: InputSize,
): StyleMap {
  const controlSize = props.size ?? defaultSize;
  return {
    boxSizing: "border-box",
    width: "100%",
    minWidth: "0",
    maxWidth: "100%",
    minHeight: px(HEIGHT[controlSize]),
    padding: `0 ${PAD_X[controlSize]}px`,
    fontSize: FONT_SIZE[controlSize],
    fontFamily: "inherit",
    color: textColor("default"),
    background: backgroundColor("surface"),
    border: `1px solid ${props.invalid ? borderColor("danger") : CONTROL_BORDER}`,
    borderRadius: props.pill === false ? radius("md") : "9999px",
    opacity: props.disabled ? 0.5 : undefined,
  };
}

/**
 * A native select without its native look, so it takes the height,
 * padding and corners of the other fields (Safari keeps a fixed, compact
 * height otherwise), with a chevron drawn on the right. The option list
 * stays native.
 */
export const SELECT_STYLE: StyleMap = {
  appearance: "none",
  WebkitAppearance: "none",
  paddingRight: px(32),
  backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#8e8e93" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5 6 7.5 9 4.5"/></svg>',
  )}")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 12px center",
  backgroundSize: "12px 12px",
};

export const FIELD_LABEL_STYLE: StyleMap = {
  ...textFont("sm"),
  fontWeight: FONT_WEIGHT.medium,
  color: textColor("secondary"),
};

const SMALL_SECONDARY_STYLE: StyleMap = {
  ...textFont("sm"),
  color: textColor("secondary"),
};

/** The style of the host of a field: a column of label, control and message. */
export function fieldStyle(weight: number | undefined): StyleMap {
  return {
    display: "flex",
    flexDirection: "column",
    gap: spacing(2),
    width: "100%",
    minWidth: "0",
    flexGrow: weight,
  };
}

/**
 * The common inputs of a control, in the Signal Forms value-control shape:
 * `value` is a `model()` that the renderer binds two-way; the host of a
 * form can also give `disabled`, `readonly`, `required`, `name`, `invalid`,
 * `errors` and `touched`, and listen to `touch`.
 */
@Directive({
  host: {
    "(focusout)": "onFocusOut()",
  },
})
export abstract class CopilotGenerativeUIControl<T> {
  readonly value = model<T>();
  readonly checks = input<ResolvedChecks>();
  readonly disabled = input<boolean>();
  readonly readonly = input<boolean>();
  readonly required = input<boolean>();
  readonly name = input<string>();
  readonly invalid = input<boolean>();
  readonly errors = input<readonly GenerativeUIValidationError[]>([]);
  readonly touched = input<boolean>();
  readonly touch = output<void>();
  /**
   * Every write of the user, also one that leaves `value` as it is: a
   * `model()` does not emit an equal value, and the node must still make the
   * path user-owned.
   */
  readonly valueWrite = output<T>();

  protected readonly aria = injectGenerativeUIAccessibility();
  /** The check state: the message to show and the invalid flag. */
  protected readonly state = createChecksState({
    checks: () => this.checks(),
    value: () => this.value(),
    errors: () => this.errors(),
    touched: () => this.touched(),
  });
  /** The ARIA of the control element itself: its name and description. */
  protected readonly control = computed(() => controlAria(this.aria()));
  /** The ARIA of the wrapper: hidden and live cover label and control. */
  protected readonly wrapper = computed(() => wrapperAria(this.aria()));
  /** True when the envelope names the control: the pair becomes a group. */
  protected readonly isNamed = computed(
    () =>
      this.aria()["aria-label"] !== undefined ||
      this.aria()["aria-description"] !== undefined,
  );
  /** `aria-invalid` of the control: the host's flag or a failed check. */
  protected readonly isInvalid = computed(() =>
    Boolean(this.invalid() || this.state.invalid()),
  );
  protected readonly checkStyle = checkMessageStyle;
  protected readonly labelStyle = FIELD_LABEL_STYLE;
  protected readonly smallStyle = SMALL_SECONDARY_STYLE;

  constructor() {
    inject(GenerativeUIStyles).ensureStandard();
  }

  /** Writes `value` for the user and tells the node about it. */
  protected setValue(next: T) {
    this.value.set(next);
    this.valueWrite.emit(next);
  }

  protected onFocusOut() {
    this.state.touch();
    this.touch.emit();
  }
}

/** The host bindings of a field: the wrapper of a label and a control. */
export const FIELD_HOST = {
  "[attr.role]": "isNamed() ? 'group' : null",
  "[attr.aria-label]": "isNamed() ? (aria()['aria-label'] ?? null) : null",
  "[attr.aria-description]":
    "isNamed() ? (aria()['aria-description'] ?? null) : null",
  "[attr.aria-hidden]": "wrapper()['aria-hidden'] ? 'true' : null",
  "[attr.aria-live]": "wrapper()['aria-live'] ?? null",
  "[style]": "hostStyle()",
};

export const CHECK_ERROR = `
    @if (state.error(); as error) {
      <span
        [attr.role]="error.severity === 'error' ? 'alert' : 'status'"
        data-a2ui-check-error
        [attr.data-a2ui-check-severity]="error.severity"
        [attr.data-a2ui-check-code]="error.code ?? null"
        [style]="checkStyle(error.severity)"
        >{{ error.message }}</span
      >
    }`;
