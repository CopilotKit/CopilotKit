import React, { useId, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { z } from "zod";
import type { GenerativeUIInvokeResult } from "../errors";
import {
  FONT_WEIGHT,
  ON_ACCENT,
  SHADOW_XS,
  backgroundColor,
  borderColor,
  radius,
  spacing,
  textColor,
  textFont,
} from "./tokens";
import { ACCENT, useStandardStyles } from "./styles";
import {
  CHILDREN_SLOT,
  VISIBLE_EVENT,
  layoutProps,
  layoutStyle,
  useVisibleOnce,
  weightProp,
} from "./layout";
import { openUrl } from "./lightbox";
import { LucideIcon } from "./media";
import {
  CHECK_ERROR_STYLE,
  checksProp,
  firstFailedCheck,
  useChecks,
} from "./checks";

/** Copies text to the clipboard. False when the API is not there. */
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ---- Shared schemas ----

/**
 * The arguments of a click or submit event: none. The model adds values
 * with the `context` of its `{ "event": ... }` binding.
 */
const NO_ARGS = z.object({});

type EventProp = (
  args: z.input<typeof NO_ARGS>,
) => Promise<GenerativeUIInvokeResult>;

/** A list of choices: plain strings or `{ value, label, description? }`. */
const optionList = z
  .array(
    z.union([
      z.string(),
      z.object({
        value: z.string(),
        label: z.string().optional(),
        description: z.string().optional(),
      }),
    ]),
  )
  .optional()
  .describe('Strings or { "value", "label", "description"? }');

type OptionList = z.output<typeof optionList>;

const SIZES = ["sm", "md", "lg", "xl"] as const;
type Size = (typeof SIZES)[number];

const size = (fallback: Size) =>
  z.enum(SIZES).optional().describe(`Default "${fallback}"`);
const pill = z.boolean().optional().describe("Default true");
const fieldLabel = z
  .string()
  .optional()
  .describe("The visible label of the field. Always set it");
const boundValue = z
  .string()
  .optional()
  .describe('Bind it with { "@path": "/x" } to read what the user entered');

const buttonSchema = z.object({
  label: z.string().optional().describe("The button text"),
  checks: checksProp,
  text: z
    .string()
    .optional()
    .describe("Same as label. Used when label is not set"),
  variant: z
    .enum(["default", "primary", "soft", "borderless"])
    .optional()
    .describe(
      'Default "default": outlined. "primary" is filled, for the one main action. "borderless" has no box, like a link',
    ),
  color: z
    .enum(["primary", "secondary", "danger"])
    .optional()
    .describe('Default "primary"'),
  size: z.enum(["sm", "md", "lg"]).optional().describe('Default "lg"'),
  block: z.boolean().optional().describe("Full width"),
  weight: weightProp,
  pill,
  disabled: z.boolean().optional(),
  loading: z.boolean().optional(),
  submit: z
    .boolean()
    .optional()
    .describe("Submits the Form around it. The Form sends its onSubmit event"),
  icon: z.string().optional().describe("Lucide icon name"),
  uniform: z.boolean().optional().describe("A square button, for an icon"),
  href: z
    .string()
    .optional()
    .describe("Opens this URL in a new tab on click, instead of onClick"),
  copy: z
    .string()
    .optional()
    .describe(
      "Copies this text to the clipboard on click and shows a check mark, instead of onClick",
    ),
});
const pressableSchema = z.object({
  ...layoutProps,
  disabled: z.boolean().optional(),
  hoverBackground: z.string().optional(),
  href: z
    .string()
    .optional()
    .describe("Opens this URL in a new tab on click, instead of onClick"),
  tooltip: z.string().optional().describe("Shown on hover"),
  ariaPressed: z.boolean().optional().describe("For a toggle"),
  insetBorder: z.boolean().optional().describe("A 1px border inside the box"),
});
const formSchema = z.object({
  ...layoutProps,
  label: z
    .string()
    .optional()
    .describe("A short name of the form for screen readers"),
});
const textFieldSchema = z.object({
  checks: checksProp,
  value: z
    .union([z.string(), z.number()])
    .optional()
    .describe('Bind it with { "@path": "/x" } to read what the user typed'),
  placeholder: z.string().optional(),
  label: fieldLabel,
  variant: z
    .enum([
      "shortText",
      "longText",
      "number",
      "obscured",
      "email",
      "url",
      "tel",
    ])
    .optional()
    .describe(
      'Default "shortText". "longText" is a multi-line field, "obscured" a password',
    ),
  weight: weightProp,
  name: z.string().optional(),
  required: z.boolean().optional(),
  disabled: z.boolean().optional(),
  invalid: z.boolean().optional(),
  size: size("xl"),
  pill,
  autoSelect: z.boolean().optional(),
  mask: z.string().optional(),
});
const textAreaSchema = z.object({
  checks: checksProp,
  value: boundValue,
  placeholder: z.string().optional(),
  label: fieldLabel,
  weight: weightProp,
  rows: z.number().optional().describe("Default 3"),
  maxRows: z.number().optional(),
  autoResize: z.boolean().optional(),
  name: z.string().optional(),
  required: z.boolean().optional(),
  disabled: z.boolean().optional(),
  invalid: z.boolean().optional(),
  size: size("xl"),
});
const selectSchema = z.object({
  checks: checksProp,
  value: boundValue,
  options: optionList,
  placeholder: z.string().optional(),
  label: fieldLabel,
  name: z.string().optional(),
  required: z.boolean().optional(),
  disabled: z.boolean().optional(),
  clearable: z.boolean().optional(),
  clearLabel: z.string().optional().describe("The label of the empty option"),
  searchable: z.boolean().optional(),
  icon: z.string().optional().describe("Lucide icon shown before the value"),
  block: z.boolean().optional().describe("Full width"),
  size: size("xl"),
  pill,
});
const checkBoxSchema = z.object({
  checks: checksProp,
  value: z
    .boolean()
    .optional()
    .describe(
      'True when checked. Bind it with { "@path": "/x" } to read the state of the box',
    ),
  label: z.string().optional().describe("The label text. Always set it"),
  name: z.string().optional(),
  weight: weightProp,
  disabled: z.boolean().optional(),
  required: z.boolean().optional(),
  lineThrough: z
    .boolean()
    .optional()
    .describe("Default false. Strikes the label when the box is checked"),
  shape: z.enum(["round", "square"]).optional().describe('Default "round"'),
});
const radioSchema = z.object({
  value: z.string().optional(),
  label: z.string().optional(),
  disabled: z.boolean().optional(),
  required: z.boolean().optional(),
});
const radioGroupSchema = z.object({
  checks: checksProp,
  value: boundValue,
  options: optionList,
  label: fieldLabel,
  name: z.string().optional(),
  direction: z.enum(["row", "col"]).optional().describe('Default "row"'),
  variant: z.enum(["list", "pills", "cards"]).optional(),
  disabled: z.boolean().optional(),
  required: z.boolean().optional(),
});
const sliderSchema = z.object({
  checks: checksProp,
  value: z
    .number()
    .optional()
    .describe('Bind it with { "@path": "/x" } to read the number'),
  min: z.number().optional().describe("Default 0"),
  max: z.number().optional().describe("Default 100"),
  step: z.number().optional().describe("Default 1"),
  steps: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "The number of equal divisions between min and max, instead of step",
    ),
  label: fieldLabel,
  weight: weightProp,
  unit: z.string().optional().describe('Unit after the value, for example "%"'),
  marks: z
    .array(z.object({ value: z.number(), label: z.string().optional() }))
    .optional(),
  sliderStyle: z
    .enum(["continuous", "discrete"])
    .optional()
    .describe('Default "continuous"'),
  disabled: z.boolean().optional(),
  name: z.string().optional(),
});
const segmentedControlSchema = z.object({
  checks: checksProp,
  value: boundValue,
  options: optionList,
  label: fieldLabel,
  block: z.boolean().optional().describe("Full width"),
  size: size("lg"),
  pill,
  variant: z
    .enum(["solid", "soft", "outline", "ghost"])
    .optional()
    .describe('Default "ghost"'),
  disabled: z.boolean().optional(),
});
const choicePickerSchema = z.object({
  checks: checksProp,
  value: z
    .array(z.string())
    .optional()
    .describe(
      'The chosen option values. Bind it with { "@path": "/x" } to a string list',
    ),
  options: optionList,
  label: fieldLabel,
  variant: z
    .enum(["multipleSelection", "mutuallyExclusive"])
    .optional()
    .describe('Default "mutuallyExclusive": the user picks one option'),
  displayStyle: z
    .enum(["checkbox", "chips"])
    .optional()
    .describe('Default "checkbox". "chips" shows the options as pills'),
  filterable: z
    .boolean()
    .optional()
    .describe("Default false. Shows a field that filters the options"),
  weight: weightProp,
  disabled: z.boolean().optional(),
  required: z.boolean().optional(),
});
const dateTimeInputSchema = z.object({
  checks: checksProp,
  value: z
    .string()
    .optional()
    .describe(
      'ISO 8601: "YYYY-MM-DD", "HH:MM" or "YYYY-MM-DDTHH:MM". Bind it with { "@path": "/x" }',
    ),
  label: fieldLabel,
  enableDate: z
    .boolean()
    .optional()
    .describe(
      "The user picks a date. Default true unless only enableTime is set",
    ),
  enableTime: z.boolean().optional().describe("The user picks a time"),
  weight: weightProp,
  min: z.string().optional().describe("The earliest value, ISO 8601"),
  max: z.string().optional().describe("The latest value, ISO 8601"),
  placeholder: z.string().optional(),
  disabled: z.boolean().optional(),
  required: z.boolean().optional(),
  clearable: z.boolean().optional(),
  block: z.boolean().optional().describe("Full width"),
});

type WithChildren<Props> = Props & { children?: ReactNode };

/** The writable list of a control that keeps its state in `value`. */
const VALUE_WRITABLE = ["value"] as const;

// ---- Control metrics ----

/*
 * Inputs (size xl) are 40px tall, with about 18px side padding and 16px
 * text. Buttons (size lg) are 36px tall pills, with 16px side padding,
 * 14px/500 text and a 6px gap to the icon.
 */
const HEIGHT: Record<Size, number> = { sm: 28, md: 32, lg: 36, xl: 40 };
/** Control text in em of the host size (13/14/14/16px at a 16px base). */
const FONT_SIZE: Record<Size, string> = {
  sm: ".8125em",
  md: ".875em",
  lg: ".875em",
  xl: "1em",
};
const PAD_X: Record<Size, number> = { sm: 10, md: 12, lg: 12, xl: 18 };
const ICON_PX: Record<Size, number> = { sm: 14, md: 16, lg: 18, xl: 18 };

/** Text inputs have a slightly stronger hairline than cards. */
const CONTROL_BORDER = "var(--a2ui-color-border-control, rgba(0, 0, 0, 0.15))";

/** A value as input text. `undefined` and `null` give an empty string. */
const asText = (value: unknown) =>
  value === undefined || value === null ? "" : String(value);

function normalizeOptions(options: OptionList) {
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

/** True when a slot got content to render. */
function hasContent(children: ReactNode) {
  if (Array.isArray(children)) return children.length > 0;
  return children !== undefined && children !== null;
}

function controlStyle(
  props: {
    size?: Size;
    pill?: boolean;
    invalid?: boolean;
    disabled?: boolean;
  },
  defaultSize: Size,
) {
  const controlSize = props.size ?? defaultSize;
  return {
    boxSizing: "border-box",
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    minHeight: HEIGHT[controlSize],
    padding: `0 ${PAD_X[controlSize]}px`,
    fontSize: FONT_SIZE[controlSize],
    fontFamily: "inherit",
    color: textColor("default"),
    background: backgroundColor("surface"),
    border: `1px solid ${props.invalid ? borderColor("danger") : CONTROL_BORDER}`,
    borderRadius: props.pill === false ? radius("md") : "9999px",
    opacity: props.disabled ? 0.5 : undefined,
  } satisfies CSSProperties;
}

const FIELD_LABEL_STYLE = {
  ...textFont("sm"),
  fontWeight: FONT_WEIGHT.medium,
  color: textColor("secondary"),
} satisfies CSSProperties;

/**
 * A label above a control. With `htmlFor`, the label is a `<label>` of that
 * control. With `labelId`, it is a text that a group points to with
 * `aria-labelledby`.
 */
function Field({
  label,
  htmlFor,
  labelId,
  weight,
  error,
  onBlur,
  children,
}: {
  label?: string;
  htmlFor?: string;
  labelId?: string;
  /** The A2UI `weight`: flex-grow in a Row or Column. */
  weight?: number;
  /** The message of a failed check, shown under the control. */
  error?: string;
  /** Called when the focus leaves the control, to mark it as touched. */
  onBlur?: () => void;
  children: ReactNode;
}) {
  const labelElement =
    htmlFor !== undefined ? (
      <label htmlFor={htmlFor} style={FIELD_LABEL_STYLE}>
        {label}
      </label>
    ) : (
      <span id={labelId} style={FIELD_LABEL_STYLE}>
        {label}
      </span>
    );
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: spacing(2),
        width: "100%",
        minWidth: 0,
        flexGrow: weight,
      }}
      onBlurCapture={onBlur}
    >
      {label ? labelElement : null}
      {children}
      <CheckError message={error} />
    </div>
  );
}

/** The message of a failed check, under a control. Nothing when none. */
function CheckError({ message }: { message: string | undefined }) {
  if (message === undefined) return null;
  return (
    <span role="alert" data-a2ui-check-error="" style={CHECK_ERROR_STYLE}>
      {message}
    </span>
  );
}

// ---- Button ----

type ButtonProps = WithChildren<
  z.output<typeof buttonSchema> & { onClick?: EventProp; child?: ReactNode }
>;

function buttonVariantStyle(
  variant: NonNullable<ButtonProps["variant"]>,
  color: ButtonProps["color"],
) {
  const accent =
    color === "danger"
      ? textColor("danger")
      : color === "secondary"
        ? backgroundColor("surface-tertiary")
        : ACCENT;
  const foreground =
    color === "danger" ? textColor("danger") : textColor("default");
  switch (variant) {
    case "primary":
      return {
        background: accent,
        color: color === "secondary" ? foreground : ON_ACCENT,
        border: "1px solid transparent",
      };
    case "soft":
      return {
        background: backgroundColor("surface-secondary"),
        color: foreground,
        border: "1px solid transparent",
      };
    case "default":
      return {
        background: "transparent",
        color: foreground,
        border: `1px solid ${color === "danger" ? accent : borderColor("default")}`,
      };
    case "borderless":
      return { background: "transparent", color: foreground, border: "none" };
  }
}

function Button(props: ButtonProps) {
  useStandardStyles();
  const [isCopied, setIsCopied] = useState(false);
  const buttonSize = props.size ?? "lg";
  const failedCheck = firstFailedCheck(props.checks);
  const isDisabled = Boolean(
    props.disabled || props.loading || failedCheck !== undefined,
  );
  const style: CSSProperties = {
    display: props.block ? "flex" : "inline-flex",
    width: props.block ? "100%" : undefined,
    flexGrow: props.weight,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    boxSizing: "border-box",
    maxWidth: "100%",
    minHeight: HEIGHT[buttonSize],
    minWidth: props.uniform ? HEIGHT[buttonSize] : undefined,
    padding: props.uniform ? 0 : `0 ${PAD_X[buttonSize] + 4}px`,
    fontSize: FONT_SIZE[buttonSize],
    fontFamily: "inherit",
    fontWeight: FONT_WEIGHT.medium,
    lineHeight: 1,
    borderRadius: props.pill === false ? radius("md") : "9999px",
    cursor: isDisabled ? "not-allowed" : "pointer",
    opacity: isDisabled ? 0.5 : undefined,
    ...buttonVariantStyle(props.variant ?? "default", props.color),
  };
  return (
    <button
      data-a2ui-input=""
      type={props.submit ? "submit" : "button"}
      disabled={isDisabled}
      title={failedCheck}
      aria-busy={props.loading ? true : undefined}
      style={style}
      onClick={(event) => {
        // Inside a Pressable, only the innermost control sends its event.
        event.stopPropagation();
        // A submit button inside a <form> lets the Form send onSubmit.
        // Outside of a form, it sends its own onClick.
        const submitsForm = props.submit && event.currentTarget.form !== null;
        if (submitsForm) return;
        // The client-side verbs (ChatGPT's openUrl and copy) never reach the
        // agent.
        if (props.href) {
          openUrl(props.href);
          return;
        }
        if (props.copy !== undefined && props.copy !== "") {
          void copyText(props.copy).then((isOk) => {
            if (!isOk) return;
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 1500);
          });
          return;
        }
        void props.onClick?.({});
      }}
      data-a2ui-copied={isCopied ? "" : undefined}
    >
      {isCopied ? (
        <span aria-hidden="true" data-icon="check" style={{ display: "flex" }}>
          <LucideIcon name="check" size={ICON_PX[buttonSize]} />
        </span>
      ) : props.icon ? (
        <span
          aria-hidden="true"
          data-icon={props.icon}
          style={{ display: "flex" }}
        >
          <LucideIcon name={props.icon} size={ICON_PX[buttonSize]} />
        </span>
      ) : null}
      {hasContent(props.child)
        ? props.child
        : hasContent(props.children)
          ? props.children
          : asText(props.label ?? props.text)}
    </button>
  );
}

// ---- Pressable and Form ----

type PressableProps = WithChildren<
  z.output<typeof pressableSchema> & {
    onClick?: EventProp;
    onVisible?: EventProp;
  }
>;

/**
 * A clickable container. It is a `div` with the button role, not a
 * `<button>`, because it can hold other controls, and a button cannot.
 * Enter and Space on the container itself press it.
 */
function Pressable(props: PressableProps) {
  useStandardStyles();
  const isDisabled = Boolean(props.disabled);
  const [isHovered, setIsHovered] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useVisibleOnce(ref, props.onVisible);
  const press = () => {
    if (isDisabled) return;
    if (props.href) openUrl(props.href);
    else void props.onClick?.({});
  };
  const showHoverBackground =
    isHovered && props.hoverBackground !== undefined && !isDisabled;
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={isDisabled ? -1 : 0}
      aria-disabled={isDisabled || undefined}
      aria-pressed={props.ariaPressed}
      title={props.tooltip}
      data-a2ui-input=""
      onClick={(event) => {
        event.stopPropagation();
        press();
      }}
      onKeyDown={(event) => {
        // A key on a nested control (a Button, an input) belongs to it.
        if (event.target !== event.currentTarget) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        press();
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        flexDirection: "column",
        ...layoutStyle(props),
        cursor: isDisabled ? "not-allowed" : "pointer",
        opacity: isDisabled ? 0.5 : undefined,
        boxShadow: props.insetBorder
          ? `inset 0 0 0 1px ${borderColor("default")}`
          : undefined,
        ...(showHoverBackground
          ? { background: backgroundColor(props.hoverBackground) }
          : {}),
      }}
    >
      {props.children}
    </div>
  );
}

type FormProps = WithChildren<
  z.output<typeof formSchema> & { onSubmit?: EventProp }
>;

function Form(props: FormProps) {
  useStandardStyles();
  return (
    <form
      aria-label={props.label}
      onSubmit={(event) => {
        event.preventDefault();
        void props.onSubmit?.({});
      }}
      style={{
        flexDirection: "column",
        ...layoutStyle(props),
        gap: spacing(props.gap ?? 4),
      }}
    >
      {props.children}
    </form>
  );
}

// ---- Text inputs ----

type TextFieldProps = z.output<typeof textFieldSchema> & {
  setValue: (value: string | number) => void;
};

/** The `type` of the input of each single-line TextField variant. */
const TEXT_FIELD_TYPE = {
  shortText: "text",
  number: "number",
  obscured: "password",
  email: "email",
  url: "url",
  tel: "tel",
} as const;

function TextField(props: TextFieldProps) {
  useStandardStyles();
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  const variant = props.variant ?? "shortText";
  const check = useChecks(props.checks, props.value);
  if (variant === "longText") {
    return (
      <TextArea
        checks={props.checks}
        value={asText(props.value)}
        placeholder={props.placeholder}
        label={props.label}
        name={props.name}
        required={props.required}
        disabled={props.disabled}
        invalid={props.invalid}
        size={props.size}
        weight={props.weight}
        setValue={props.setValue}
      />
    );
  }
  return (
    <Field
      label={props.label}
      htmlFor={id}
      weight={props.weight}
      error={check.error}
      onBlur={check.onBlur}
    >
      <input
        ref={ref}
        id={id}
        data-a2ui-input=""
        type={TEXT_FIELD_TYPE[variant]}
        name={props.name}
        placeholder={props.placeholder}
        // Without a visible label, the placeholder still names the field.
        aria-label={props.label ? undefined : props.placeholder}
        required={props.required}
        disabled={props.disabled}
        aria-invalid={props.invalid || check.invalid || undefined}
        value={asText(props.value)}
        onFocus={props.autoSelect ? () => ref.current?.select() : undefined}
        onChange={(event) => props.setValue(event.target.value)}
        style={controlStyle(props, "xl")}
      />
    </Field>
  );
}

type TextAreaProps = z.output<typeof textAreaSchema> & {
  setValue: (value: string) => void;
};

function TextArea(props: TextAreaProps) {
  useStandardStyles();
  const id = useId();
  const areaSize = props.size ?? "xl";
  const check = useChecks(props.checks, props.value);
  return (
    <Field
      label={props.label}
      htmlFor={id}
      weight={props.weight}
      error={check.error}
      onBlur={check.onBlur}
    >
      <textarea
        id={id}
        data-a2ui-input=""
        name={props.name}
        placeholder={props.placeholder}
        aria-label={props.label ? undefined : props.placeholder}
        required={props.required}
        disabled={props.disabled}
        aria-invalid={props.invalid || check.invalid || undefined}
        rows={props.rows ?? 3}
        value={asText(props.value)}
        onChange={(event) => {
          props.setValue(event.target.value);
          if (!props.autoResize) return;
          const element = event.target;
          element.style.height = "auto";
          element.style.height = `${element.scrollHeight}px`;
        }}
        style={{
          ...controlStyle({ ...props, pill: false }, areaSize),
          padding: `${PAD_X[areaSize] / 2}px ${PAD_X[areaSize]}px`,
          resize: props.autoResize ? "none" : "vertical",
          maxHeight: props.maxRows
            ? `calc(${props.maxRows} * 1.5em + ${PAD_X[areaSize]}px)`
            : undefined,
          lineHeight: 1.5,
        }}
      />
    </Field>
  );
}

type DateTimeInputProps = z.output<typeof dateTimeInputSchema> & {
  setValue: (value: string) => void;
};

/** The input type: a date by default, a time, or both. */
function dateTimeInputType(props: DateTimeInputProps) {
  const hasTime = props.enableTime === true;
  const hasDate = props.enableDate ?? !hasTime;
  return hasDate && hasTime ? "datetime-local" : hasTime ? "time" : "date";
}

function DateTimeInput(props: DateTimeInputProps) {
  useStandardStyles();
  const id = useId();
  const value = asText(props.value);
  const showClear = props.clearable && value !== "";
  const check = useChecks(props.checks, props.value);
  return (
    <Field
      label={props.label}
      htmlFor={id}
      weight={props.weight}
      error={check.error}
      onBlur={check.onBlur}
    >
      <div
        style={{
          display: props.block ? "flex" : "inline-flex",
          width: props.block ? "100%" : undefined,
          gap: spacing(2),
          alignItems: "center",
        }}
      >
        <input
          id={id}
          type={dateTimeInputType(props)}
          data-a2ui-input=""
          min={props.min}
          max={props.max}
          placeholder={props.placeholder}
          aria-label={props.label ? undefined : props.placeholder}
          disabled={props.disabled}
          required={props.required}
          aria-invalid={check.invalid || undefined}
          value={value}
          onChange={(event) => props.setValue(event.target.value)}
          style={controlStyle(props, "xl")}
        />
        {showClear ? (
          <button
            type="button"
            data-a2ui-input=""
            aria-label="Clear"
            onClick={() => props.setValue("")}
            style={{
              minWidth: 24,
              minHeight: 24,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: textColor("secondary"),
            }}
          >
            <span aria-hidden="true">×</span>
          </button>
        ) : null}
      </div>
    </Field>
  );
}

// ---- Choices ----

type ChoicePickerProps = z.output<typeof choicePickerSchema> & {
  setValue: (value: string[]) => void;
};

/**
 * One or more options from a list, as checkboxes (or radios, for one
 * choice) or as chips. The value is always a list of option values.
 */
function ChoicePicker(props: ChoicePickerProps) {
  useStandardStyles();
  const labelId = useId();
  const fallbackName = useId();
  const [filter, setFilter] = useState("");
  const isMultiple = props.variant === "multipleSelection";
  const isChips = props.displayStyle === "chips";
  const chosen = Array.isArray(props.value) ? props.value : [];
  const check = useChecks(props.checks, chosen);
  const options = normalizeOptions(props.options);
  const shown = filter
    ? options.filter((option) =>
        option.label.toLowerCase().includes(filter.toLowerCase()),
      )
    : options;
  const toggle = (value: string) => {
    if (!isMultiple) {
      props.setValue(chosen.includes(value) ? [] : [value]);
      return;
    }
    props.setValue(
      chosen.includes(value)
        ? chosen.filter((item) => item !== value)
        : [...chosen, value],
    );
  };
  return (
    <Field
      label={props.label}
      labelId={labelId}
      weight={props.weight}
      error={check.error}
      onBlur={check.onBlur}
    >
      {props.filterable ? (
        <input
          type="search"
          data-a2ui-input=""
          aria-label="Filter options"
          placeholder="Filter…"
          value={filter}
          disabled={props.disabled}
          onChange={(event) => setFilter(event.target.value)}
          style={controlStyle(props, "lg")}
        />
      ) : null}
      {props.required ? (
        // The checkboxes and chips carry no selection of their own, so this
        // sentinel makes an empty required choice fail the Form's
        // constraint validation. It is invisible and not in the tab order.
        <input
          tabIndex={-1}
          aria-hidden="true"
          required
          disabled={props.disabled}
          name={undefined}
          value={chosen.join(",")}
          onChange={() => {}}
          style={{
            position: "absolute",
            opacity: 0,
            width: 1,
            height: 1,
            margin: 0,
            padding: 0,
            border: 0,
            pointerEvents: "none",
          }}
        />
      ) : null}
      <div
        role={isChips ? "group" : isMultiple ? "group" : "radiogroup"}
        aria-labelledby={props.label ? labelId : undefined}
        aria-required={props.required || undefined}
        aria-invalid={check.invalid || undefined}
        style={{
          display: "flex",
          flexDirection: isChips ? "row" : "column",
          flexWrap: isChips ? "wrap" : undefined,
          gap: spacing(2),
          opacity: props.disabled ? 0.5 : undefined,
        }}
      >
        {shown.map((option) => {
          const isSelected = chosen.includes(option.value);
          if (isChips) {
            return (
              <button
                key={option.value}
                type="button"
                data-a2ui-input=""
                aria-pressed={isSelected}
                disabled={props.disabled}
                onClick={() => toggle(option.value)}
                style={{
                  ...radioOptionStyle("pills", isSelected),
                  background: isSelected
                    ? backgroundColor("surface-secondary")
                    : "transparent",
                  color: textColor("default"),
                  fontFamily: "inherit",
                  cursor: props.disabled ? "not-allowed" : "pointer",
                }}
              >
                {option.label}
              </button>
            );
          }
          return (
            <label key={option.value} style={radioOptionStyle("list", false)}>
              <input
                type={isMultiple ? "checkbox" : "radio"}
                className="a2ui-std-check"
                data-a2ui-input=""
                name={fallbackName}
                value={option.value}
                checked={isSelected}
                disabled={props.disabled}
                onChange={() => toggle(option.value)}
                onClick={
                  // A radio does not fire onChange when it is already checked.
                  !isMultiple && isSelected
                    ? () => toggle(option.value)
                    : undefined
                }
              />
              <span style={{ display: "flex", flexDirection: "column" }}>
                <span>{option.label}</span>
                {option.description ? (
                  <span
                    style={{ ...textFont("sm"), color: textColor("secondary") }}
                  >
                    {option.description}
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
    </Field>
  );
}

type SelectProps = z.output<typeof selectSchema> & {
  setValue: (value: string) => void;
};

function Select(props: SelectProps) {
  useStandardStyles();
  const id = useId();
  const options = normalizeOptions(props.options);
  const value = asText(props.value);
  const check = useChecks(props.checks, props.value);
  const hasEmptyOption = Boolean(
    props.placeholder || props.clearable || value === "",
  );
  const select = (
    <select
      id={id}
      data-a2ui-input=""
      name={props.name}
      aria-label={props.label ? undefined : props.placeholder}
      required={props.required}
      disabled={props.disabled}
      aria-invalid={check.invalid || undefined}
      value={value}
      onChange={(event) => props.setValue(event.target.value)}
      style={{
        ...controlStyle(props, "xl"),
        width: props.block === false ? undefined : "100%",
        paddingLeft: props.icon
          ? `${PAD_X[props.size ?? "xl"] + 24}px`
          : undefined,
      }}
    >
      {hasEmptyOption ? (
        <option value="">{props.clearLabel ?? props.placeholder ?? ""}</option>
      ) : null}
      {options.map((option) => (
        <option
          key={option.value}
          value={option.value}
          title={option.description}
        >
          {option.label}
        </option>
      ))}
    </select>
  );
  return (
    <Field
      label={props.label}
      htmlFor={id}
      error={check.error}
      onBlur={check.onBlur}
    >
      {props.icon ? (
        <span style={{ position: "relative", display: "flex", width: "100%" }}>
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              left: PAD_X[props.size ?? "xl"],
              top: "50%",
              transform: "translateY(-50%)",
              display: "flex",
              pointerEvents: "none",
              color: textColor("secondary"),
            }}
          >
            <LucideIcon name={props.icon} size={16} />
          </span>
          {select}
        </span>
      ) : (
        select
      )}
    </Field>
  );
}

type CheckBoxProps = z.output<typeof checkBoxSchema> & {
  setValue: (value: boolean) => void;
};

function CheckBox(props: CheckBoxProps) {
  useStandardStyles();
  const isChecked = Boolean(props.value);
  const hasLabel = props.label !== undefined && props.label !== "";
  const check = useChecks(props.checks, props.value);
  return (
    <span
      style={{
        display: "inline-flex",
        flexDirection: "column",
        gap: spacing(1),
        flexGrow: props.weight,
      }}
      onBlurCapture={check.onBlur}
    >
      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          flexGrow: props.weight,
          gap: spacing(2),
          cursor: props.disabled ? "not-allowed" : "pointer",
          opacity: props.disabled ? 0.5 : undefined,
          ...textFont("md"),
          color: textColor("default"),
        }}
      >
        <input
          type="checkbox"
          className="a2ui-std-check"
          data-a2ui-input=""
          data-shape={props.shape ?? "round"}
          name={props.name}
          aria-label={hasLabel ? undefined : props.name}
          required={props.required}
          disabled={props.disabled}
          checked={isChecked}
          aria-invalid={check.invalid || undefined}
          onChange={(event) => props.setValue(event.target.checked)}
        />
        {hasLabel ? (
          <span
            style={{
              textDecoration:
                props.lineThrough && isChecked ? "line-through" : undefined,
            }}
          >
            {props.label}
          </span>
        ) : null}
      </label>
      <CheckError message={check.error} />
    </span>
  );
}

function Radio(props: z.output<typeof radioSchema>) {
  useStandardStyles();
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: spacing(2),
        ...textFont("md"),
      }}
    >
      <input
        type="radio"
        className="a2ui-std-check"
        data-a2ui-input=""
        value={props.value}
        disabled={props.disabled}
        required={props.required}
      />
      {props.label ?? props.value}
    </label>
  );
}

type RadioGroupProps = z.output<typeof radioGroupSchema> & {
  setValue: (value: string) => void;
};

function radioOptionStyle(
  variant: NonNullable<RadioGroupProps["variant"]>,
  isSelected: boolean,
) {
  const base = {
    display: "inline-flex",
    alignItems: variant === "cards" ? "flex-start" : "center",
    gap: spacing(2),
    cursor: "pointer",
    ...textFont("md"),
  } satisfies CSSProperties;
  if (variant === "list") return base;
  return {
    ...base,
    padding: variant === "cards" ? spacing(3) : `4px ${spacing(3)}`,
    border: `1px solid ${isSelected ? ACCENT : borderColor("default")}`,
    borderRadius: variant === "pills" ? "9999px" : radius("lg"),
  };
}

/** Native radios in a fieldset, so the arrow keys work without extra code. */
function RadioGroup(props: RadioGroupProps) {
  useStandardStyles();
  const fallbackName = useId();
  const name = props.name ?? fallbackName;
  const options = normalizeOptions(props.options);
  const value = asText(props.value);
  const variant = props.variant ?? "list";
  const check = useChecks(props.checks, props.value);
  return (
    <fieldset
      disabled={props.disabled}
      aria-invalid={check.invalid || undefined}
      onBlurCapture={check.onBlur}
      style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
    >
      {props.label ? (
        <legend
          style={{ ...FIELD_LABEL_STYLE, padding: 0, marginBottom: spacing(1) }}
        >
          {props.label}
        </legend>
      ) : null}
      <div
        style={{
          display: "flex",
          flexDirection: props.direction === "col" ? "column" : "row",
          flexWrap: "wrap",
          gap: spacing(variant === "list" ? 3 : 2),
        }}
      >
        {options.map((option) => {
          const isSelected = option.value === value;
          return (
            <label
              key={option.value}
              style={radioOptionStyle(variant, isSelected)}
            >
              <input
                type="radio"
                data-a2ui-input=""
                name={name}
                value={option.value}
                required={props.required}
                checked={isSelected}
                onChange={() => props.setValue(option.value)}
                className="a2ui-std-check"
              />
              <span style={{ display: "flex", flexDirection: "column" }}>
                <span>{option.label}</span>
                {option.description ? (
                  <span
                    style={{ ...textFont("sm"), color: textColor("secondary") }}
                  >
                    {option.description}
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
      <CheckError message={check.error} />
    </fieldset>
  );
}

type SegmentedControlProps = z.output<typeof segmentedControlSchema> & {
  setValue: (value: string) => void;
};

/**
 * The option that an arrow key, Home or End moves to, or `undefined` for
 * other keys. The arrow keys wrap at the ends.
 */
function nextOptionIndex(key: string, index: number, count: number) {
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (index + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return undefined;
  }
}

function segmentStyle(
  props: SegmentedControlProps,
  isSelected: boolean,
  segmentSize: Size,
  isPill: boolean,
) {
  const isSolid = props.variant === "solid";
  const selectedBackground = isSolid ? ACCENT : backgroundColor("surface");
  const selectedColor = isSolid ? ON_ACCENT : textColor("default");
  return {
    flex: props.block ? 1 : undefined,
    minHeight: HEIGHT[segmentSize] - 4,
    padding: `0 ${PAD_X[segmentSize]}px`,
    fontSize: FONT_SIZE[segmentSize],
    fontFamily: "inherit",
    fontWeight: FONT_WEIGHT.medium,
    border: "none",
    cursor: props.disabled ? "not-allowed" : "pointer",
    borderRadius: isPill ? "9999px" : radius("sm"),
    background: isSelected ? selectedBackground : "transparent",
    color: isSelected ? selectedColor : textColor("secondary"),
    boxShadow: isSelected && !isSolid ? SHADOW_XS : undefined,
  } satisfies CSSProperties;
}

/**
 * A radio group drawn as buttons. It is one tab stop: the selected segment
 * (or the first one) is in the tab order, and the arrow keys, Home and End
 * move the focus and select the segment.
 */
function SegmentedControl(props: SegmentedControlProps) {
  useStandardStyles();
  const labelId = useId();
  const segments = useRef<(HTMLButtonElement | null)[]>([]);
  const segmentSize = props.size ?? "lg";
  const options = normalizeOptions(props.options);
  const value = asText(props.value);
  const isPill = props.pill !== false;
  const check = useChecks(props.checks, props.value);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const tabStopIndex = selectedIndex === -1 ? 0 : selectedIndex;
  const onKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const next = nextOptionIndex(event.key, index, options.length);
    if (next === undefined) return;
    event.preventDefault();
    props.setValue(options[next].value);
    segments.current[next]?.focus();
  };
  return (
    <Field
      label={props.label}
      labelId={labelId}
      error={check.error}
      onBlur={check.onBlur}
    >
      <div
        role="radiogroup"
        aria-labelledby={props.label ? labelId : undefined}
        style={{
          display: props.block ? "flex" : "inline-flex",
          width: props.block ? "100%" : undefined,
          gap: 2,
          padding: 2,
          boxSizing: "border-box",
          background: backgroundColor("surface-secondary"),
          border:
            props.variant === "outline"
              ? `1px solid ${borderColor("default")}`
              : undefined,
          borderRadius: isPill ? "9999px" : radius("md"),
          opacity: props.disabled ? 0.5 : undefined,
        }}
      >
        {options.map((option, index) => {
          const isSelected = index === selectedIndex;
          return (
            <button
              key={option.value}
              ref={(element) => {
                segments.current[index] = element;
              }}
              type="button"
              role="radio"
              aria-checked={isSelected}
              tabIndex={index === tabStopIndex ? 0 : -1}
              data-a2ui-input=""
              disabled={props.disabled}
              onClick={(event) => {
                event.stopPropagation();
                props.setValue(option.value);
              }}
              onKeyDown={(event) => onKeyDown(event, index)}
              style={segmentStyle(props, isSelected, segmentSize, isPill)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </Field>
  );
}

// ---- Slider ----

type SliderProps = z.output<typeof sliderSchema> & {
  setValue: (value: number) => void;
};

function Slider(props: SliderProps) {
  useStandardStyles();
  const id = useId();
  const listId = useId();
  const min = props.min ?? 0;
  const max = props.max ?? 100;
  const value = props.value ?? min;
  const marks = props.marks ?? [];
  const step = props.steps ? (max - min) / props.steps : (props.step ?? 1);
  const isDiscrete = props.sliderStyle === "discrete";
  const check = useChecks(props.checks, props.value);
  const valueText = props.unit ? `${value} ${props.unit}` : `${value}`;
  const showValue = Boolean(props.label || props.unit);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: spacing(2),
        width: "100%",
        minWidth: 0,
        flexGrow: props.weight,
      }}
      onBlurCapture={check.onBlur}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: spacing(2),
          ...textFont("sm"),
        }}
      >
        {props.label ? (
          <label
            htmlFor={id}
            style={{
              fontWeight: FONT_WEIGHT.medium,
              color: textColor("secondary"),
            }}
          >
            {props.label}
          </label>
        ) : (
          <span />
        )}
        <span
          style={{
            fontWeight: FONT_WEIGHT.semibold,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {showValue ? valueText : null}
        </span>
      </div>
      <input
        id={id}
        type="range"
        className="a2ui-std-range"
        data-a2ui-input=""
        name={props.name}
        aria-label={props.label ? undefined : props.name}
        aria-valuetext={props.unit ? valueText : undefined}
        min={min}
        max={max}
        step={step}
        disabled={props.disabled}
        value={value}
        list={isDiscrete && marks.length > 0 ? listId : undefined}
        onChange={(event) => props.setValue(Number(event.target.value))}
      />
      {marks.length > 0 ? (
        <>
          <datalist id={listId}>
            {marks.map((mark) => (
              <option key={mark.value} value={mark.value} label={mark.label} />
            ))}
          </datalist>
          <div
            aria-hidden="true"
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: spacing(2),
              fontSize: ".875em",
              lineHeight: 1.3,
              color: textColor("secondary"),
            }}
          >
            {marks.map((mark) => (
              <span key={mark.value}>{mark.label ?? mark.value}</span>
            ))}
          </div>
        </>
      ) : null}
      <CheckError message={check.error} />
    </div>
  );
}

// ---- Catalog ----

/**
 * The standard input components: Button, Pressable, Form, and the controls.
 * Give them to `createGenerativeUI({ components: { ...inputComponents } })`.
 *
 * - Button and Pressable send `onClick`. Form sends `onSubmit`. The model
 *   binds an event to `{ "event": { "name", "userMessage"?, "context"? } }`
 *   or `{ "functionCall": { "@call", "args"? } }`, or an app function with
 *   the same name binds it automatically.
 * - The value of a control is writable: `value`.
 *   When the model binds it to `{ "@path": "/x" }`, what the user enters goes
 *   into the data model at that path, and the agent can no longer change it.
 */
export const inputComponents = {
  Button: {
    component: Button,
    description:
      'A button that sends its onClick event. With href it opens the URL, and with copy it copies the text, both without the agent. Use variant "primary" for the one main Button in a Row, and the default for the others. With submit true inside a Form, it submits the Form. The child or children render instead of the label. With checks, it is disabled while a check fails.',
    props: buttonSchema,
    events: {
      onClick: {
        description: "Sent when the user clicks the button.",
        parameters: NO_ARGS,
      },
    },
    slots: { child: "single", children: "multiple" } as const,
  },
  Pressable: {
    component: Pressable,
    description:
      "A layout container that the user can click or press with Enter or Space. It sends its onClick event, or opens href. A control inside it sends only its own event.",
    props: pressableSchema,
    events: {
      ...VISIBLE_EVENT,
      onClick: {
        description: "Sent when the user clicks or presses the container.",
        parameters: NO_ARGS,
      },
    },
    slots: CHILDREN_SLOT,
  },
  Form: {
    component: Form,
    description:
      'A layout container that is a form. It sends its onSubmit event when the user submits it (a Button with submit true, or Enter in a field). Put the values of its fields in the event context with { "@path": "/x" }.',
    props: formSchema,
    events: {
      onSubmit: {
        description: "Sent when the user submits the form.",
        parameters: NO_ARGS,
      },
    },
    slots: CHILDREN_SLOT,
  },
  TextField: {
    component: TextField,
    description:
      'A text input, single-line unless variant is "longText". Bind value with { "@path": "/x" } to read what the user typed. Give it a label.',
    props: textFieldSchema,
    writable: VALUE_WRITABLE,
  },
  TextArea: {
    component: TextArea,
    description:
      'A multi-line text input. Bind value with { "@path": "/x" } to read what the user typed. Give it a label.',
    props: textAreaSchema,
    writable: VALUE_WRITABLE,
  },
  Select: {
    component: Select,
    description:
      'A dropdown list of options. Bind value with { "@path": "/x" } to read the chosen option. Give it a label.',
    props: selectSchema,
    writable: VALUE_WRITABLE,
  },
  CheckBox: {
    component: CheckBox,
    description:
      'A checkbox with a label. Bind value with { "@path": "/x" } to read its state, true or false.',
    props: checkBoxSchema,
    writable: VALUE_WRITABLE,
  },
  Radio: {
    component: Radio,
    description:
      "One radio button. Use RadioGroup instead, because it keeps the chosen value.",
    props: radioSchema,
  },
  RadioGroup: {
    component: RadioGroup,
    description:
      'A group of radio buttons. The user chooses one option. Bind value with { "@path": "/x" } to read it. Give it a label.',
    props: radioGroupSchema,
    writable: VALUE_WRITABLE,
  },
  Slider: {
    component: Slider,
    description:
      'A range slider for a number between min and max. Bind value with { "@path": "/x" } to read the number. Give it a label.',
    props: sliderSchema,
    writable: VALUE_WRITABLE,
  },
  SegmentedControl: {
    component: SegmentedControl,
    description:
      'A row of segments. The user chooses one option. Use it for 2 to 5 short options. Bind value with { "@path": "/x" } to read it.',
    props: segmentedControlSchema,
    writable: VALUE_WRITABLE,
  },
  ChoicePicker: {
    component: ChoicePicker,
    description:
      'A list of options, as checkboxes or chips. The user picks one, or several with variant "multipleSelection". Bind value with { "@path": "/x" } to read the chosen values as a list. Give it a label.',
    props: choicePickerSchema,
    writable: VALUE_WRITABLE,
  },
  DateTimeInput: {
    component: DateTimeInput,
    description:
      'A date picker, or a time picker with enableTime, or both. The value is ISO 8601. Bind value with { "@path": "/x" } to read it. Give it a label.',
    props: dateTimeInputSchema,
    writable: VALUE_WRITABLE,
  },
};
