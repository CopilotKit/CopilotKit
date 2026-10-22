import React, { useEffect, useId, useRef, useState } from "react";
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
import {
  controlAria,
  useGenerativeUIAccessibility,
  wrapperAria,
} from "../accessibility";
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
  checkMessageStyle,
  checksProp,
  firstFailedCheck,
  useChecks,
} from "./checks";
import type { FailedCheck } from "./checks";

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
  timeStep: z
    .number()
    .int()
    .min(1)
    .max(720)
    .optional()
    .describe(
      "Minutes between the times the user can pick, e.g. 15 or 30. Shows the time as a list",
    ),
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

/**
 * A native select without its native look, so it takes the height,
 * padding and corners of the other fields (Safari keeps a fixed, compact
 * height otherwise), with a chevron drawn on the right. The option list
 * stays native.
 */
const SELECT_STYLE = {
  appearance: "none",
  WebkitAppearance: "none",
  paddingRight: 32,
  backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#8e8e93" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5 6 7.5 9 4.5"/></svg>',
  )}")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 12px center",
  backgroundSize: "12px 12px",
} satisfies CSSProperties;

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
  /** The failed check, shown under the control. */
  error?: FailedCheck;
  /** Called when the focus leaves the control, to mark it as touched. */
  onBlur?: () => void;
  children: ReactNode;
}) {
  // The envelope of the control: hidden hides label and control; a label
  // or a description names the pair as a group, and the control itself
  // takes them too (see controlAria), because ARIA names do not inherit.
  const aria = useGenerativeUIAccessibility();
  const isNamed =
    aria["aria-label"] !== undefined || aria["aria-description"] !== undefined;
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
      {...wrapperAria(aria)}
      role={isNamed ? "group" : undefined}
      aria-label={isNamed ? aria["aria-label"] : undefined}
      aria-description={isNamed ? aria["aria-description"] : undefined}
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
      <CheckError check={error} />
    </div>
  );
}

/**
 * The message of a failed check, under a control. Nothing when none. An
 * error is an alert; a warning or an info is a status, in its own color.
 */
function CheckError({ check }: { check: FailedCheck | undefined }) {
  if (check === undefined) return null;
  return (
    <span
      role={check.severity === "error" ? "alert" : "status"}
      data-a2ui-check-error=""
      data-a2ui-check-severity={check.severity}
      data-a2ui-check-code={check.code}
      style={checkMessageStyle(check.severity)}
    >
      {check.message}
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
  const aria = useGenerativeUIAccessibility();
  const [isCopied, setIsCopied] = useState(false);
  const buttonSize = props.size ?? "lg";
  // A warning or an info does not hold the button back.
  const failedCheck = firstFailedCheck(props.checks);
  const blockingCheck =
    failedCheck?.severity === "error" ? failedCheck : undefined;
  const isDisabled = Boolean(
    props.disabled || props.loading || blockingCheck !== undefined,
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
      {...aria}
      disabled={isDisabled}
      title={failedCheck?.message}
      aria-busy={props.loading ? true : undefined}
      style={style}
      onClick={(event) => {
        // Inside a Pressable, only the innermost control sends its event.
        event.stopPropagation();
        // A submit button inside a <form> lets the Form send onSubmit.
        // Outside of a form, it sends its own onClick.
        const submitsForm = props.submit && event.currentTarget.form !== null;
        if (submitsForm) return;
        // The client-side verbs (open a URL, copy text) never reach the
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
  const aria = useGenerativeUIAccessibility();
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
      {...aria}
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
  const aria = useGenerativeUIAccessibility();
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
        {...controlAria(aria)}
      />
    </Field>
  );
}

type TextAreaProps = z.output<typeof textAreaSchema> & {
  setValue: (value: string) => void;
};

function TextArea(props: TextAreaProps) {
  useStandardStyles();
  const aria = useGenerativeUIAccessibility();
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
        {...controlAria(aria)}
      />
    </Field>
  );
}

type DateTimeInputProps = z.output<typeof dateTimeInputSchema> & {
  setValue: (value: string) => void;
};

type DateTimeMode = "date" | "time" | "datetime";

/** What the user picks: a date by default, a time, or both. */
function dateTimeMode(props: DateTimeInputProps): DateTimeMode {
  const hasTime = props.enableTime === true;
  const hasDate = props.enableDate ?? !hasTime;
  return hasDate && hasTime ? "datetime" : hasTime ? "time" : "date";
}

interface DateTimeParts {
  /** "YYYY-MM-DD", or "" */
  date: string;
  /** "HH:MM" (seconds kept when given), or "" */
  time: string;
}

/** The date and the time of an ISO 8601 value: a date, a time, or both. */
export function splitDateTime(value: string): DateTimeParts {
  const [head, tail] = value.split("T");
  if (tail !== undefined) return { date: head, time: tail };
  if (/^\d{4}-/.test(value)) return { date: value, time: "" };
  if (/^\d{1,2}:\d{2}/.test(value)) return { date: "", time: value };
  return { date: "", time: "" };
}

/** The value of the parts, or "" while a part the mode needs is missing. */
function joinDateTime(parts: DateTimeParts, mode: DateTimeMode): string {
  if (mode === "date") return parts.date;
  if (mode === "time") return parts.time;
  return parts.date && parts.time ? `${parts.date}T${parts.time}` : "";
}

/**
 * The value in words, in the user's locale: "Thu, Oct 23, 2026, 2:30 PM".
 * Undefined for an incomplete or unparsable value.
 */
export function describeDateTime(
  parts: DateTimeParts,
  mode: DateTimeMode,
  locale?: string,
): string | undefined {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(parts.date);
  const time = /^(\d{1,2}):(\d{2})/.exec(parts.time);
  if ((mode !== "time" && !date) || (mode !== "date" && !time)) return;
  // The value has no time zone: it is formatted as written, in UTC, so a
  // daylight-saving gap of the viewer cannot shift it.
  const at = new Date(
    Date.UTC(
      date ? Number(date[1]) : 2000,
      date ? Number(date[2]) - 1 : 0,
      date ? Number(date[3]) : 1,
      time ? Number(time[1]) : 0,
      time ? Number(time[2]) : 0,
    ),
  );
  // Date.UTC rolls an impossible value over (February 30 to March 2); such
  // a value gets no summary rather than a different one.
  const exact =
    (!date ||
      (at.getUTCFullYear() === Number(date[1]) &&
        at.getUTCMonth() === Number(date[2]) - 1 &&
        at.getUTCDate() === Number(date[3]))) &&
    (!time ||
      (at.getUTCHours() === Number(time[1]) &&
        at.getUTCMinutes() === Number(time[2])));
  if (Number.isNaN(at.getTime()) || !exact) return;
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    ...(mode === "time"
      ? {}
      : { weekday: "short", year: "numeric", month: "short", day: "numeric" }),
    ...(mode === "date" ? {} : { hour: "numeric", minute: "2-digit" }),
  }).format(at);
}

/** "HH:MM" of a minute of the day. */
function minuteToTime(minute: number) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
}

/** "HH:MM:SS" of a time, seconds "00" when left out, so times compare as text. */
function fullTime(time: string) {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(time);
  if (!match) return time;
  return `${match[1].padStart(2, "0")}:${match[2]}:${match[3] ?? "00"}`;
}

/** The minute of the day of a time, rounded up to a whole minute. */
function timeToMinute(time: string) {
  const [hours, minutes, seconds] = fullTime(time).split(":").map(Number);
  return hours * 60 + minutes + (seconds > 0 ? 1 : 0);
}

/**
 * True when `time` lies within `min`..`max`, seconds included. A `min`
 * after `max` is a range over midnight, such as 22:00 to 02:00.
 */
export function timeInRange(time: string, min?: string, max?: string) {
  const at = fullTime(time);
  const from = min ? fullTime(min) : undefined;
  const to = max ? fullTime(max) : undefined;
  if (from && to && from > to) return at >= from || at <= to;
  return (!from || at >= from) && (!to || at <= to);
}

/**
 * The times `step` minutes apart from `min` (or midnight) up to `max` (or
 * the end of the day), "HH:MM". A range over midnight continues after
 * 23:59. `current` is added when it is set and not one of them, so the list
 * shows the value it holds even when that value is out of range.
 */
export function timeSlots(
  step: number,
  min?: string,
  max?: string,
  current?: string,
): string[] {
  const day = 24 * 60;
  const start = min ? timeToMinute(min) : 0;
  let end = max
    ? timeToMinute(max) - (fullTime(max).endsWith(":00") ? 0 : 1)
    : day - 1;
  if (end < start) end += day;
  const slots: string[] = [];
  for (
    let minute = start;
    minute <= end && minute < start + day;
    minute += step
  ) {
    slots.push(minuteToTime(minute % day));
  }
  const shown = current?.slice(0, 5);
  if (shown && !slots.includes(shown)) {
    // In order from the start of the range.
    const offset = (time: string) => (timeToMinute(time) - start + day) % day;
    const index = slots.findIndex((slot) => offset(slot) > offset(shown));
    slots.splice(index === -1 ? slots.length : index, 0, shown);
  }
  return slots;
}

/**
 * A date, a time, or both. A date and a time are two fields under one
 * label, so each stays short and readable in every browser; the value is
 * written once both are set. Under the fields, the value in words makes the
 * date and the time (AM/PM included) unambiguous. `timeStep` shows the time
 * as a list of times instead of a typed field.
 */
function DateTimeInput(props: DateTimeInputProps) {
  useStandardStyles();
  const aria = useGenerativeUIAccessibility();
  const id = useId();
  const labelId = useId();
  const summaryId = useId();
  const mode = dateTimeMode(props);
  const value = asText(props.value);
  const check = useChecks(props.checks, props.value);
  const [parts, setParts] = useState(() => splitDateTime(value));
  // The last value this control wrote. A different value comes from the
  // data model (the agent, a binding) and replaces the parts; the control's
  // own write keeps a half-filled date and time as they are.
  const written = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (value === written.current) return;
    written.current = undefined;
    setParts(splitDateTime(value));
  }, [value]);
  const write = (next: DateTimeParts) => {
    setParts(next);
    const nextValue = joinDateTime(next, mode);
    written.current = nextValue;
    // Written even when unchanged: the write makes the value the user's, so
    // a later agent write does not replace a half-filled date and time.
    props.setValue(nextValue);
  };

  const min = splitDateTime(asText(props.min));
  const max = splitDateTime(asText(props.max));
  // A bound on the time applies on its own day only, when there is a date.
  const timeMin =
    mode === "time" || (min.time && parts.date === min.date)
      ? min.time || undefined
      : undefined;
  const timeMax =
    mode === "time" || (max.time && parts.date === max.date)
      ? max.time || undefined
      : undefined;

  // A list does not enforce min and max like a time field does: a time
  // left out of range (the date moved to the day of a bound) is invalid.
  const slotList = useRef<HTMLSelectElement>(null);
  const slotOutOfRange =
    props.timeStep !== undefined &&
    parts.time !== "" &&
    !timeInRange(parts.time, timeMin, timeMax);
  const rangeError: FailedCheck | undefined = slotOutOfRange
    ? {
        message: `Pick a time from ${
          (timeMin && describeDateTime({ date: "", time: timeMin }, "time")) ||
          "the start of the day"
        } to ${
          (timeMax && describeDateTime({ date: "", time: timeMax }, "time")) ||
          "the end of the day"
        }`,
        severity: "error",
        code: "TIME_OUT_OF_RANGE",
      }
    : undefined;
  // Half a date and time is no value: the empty field is invalid, so a
  // form does not drop what the user entered. Both empty stays valid.
  const dateField = useRef<HTMLInputElement>(null);
  const timeInput = useRef<HTMLInputElement>(null);
  const halfFilled =
    mode === "datetime" && (parts.date === "") !== (parts.time === "");
  const dateMessage = halfFilled && parts.date === "" ? "Pick a date too" : "";
  const timeMessage =
    rangeError?.message ??
    (halfFilled && parts.time === "" ? "Pick a time too" : "");
  useEffect(() => {
    dateField.current?.setCustomValidity(dateMessage);
    slotList.current?.setCustomValidity(timeMessage);
    timeInput.current?.setCustomValidity(timeMessage);
  }, [dateMessage, timeMessage, props.timeStep]);

  const summary = describeDateTime(parts, mode);
  const isSplit = mode === "datetime";
  const showClear = props.clearable && (parts.date !== "" || parts.time !== "");
  const style = controlStyle({ ...props, pill: false }, "xl");
  const common = {
    "data-a2ui-input": "",
    disabled: props.disabled,
    required: props.required,
    "aria-invalid": check.invalid || undefined,
    "aria-describedby": summary ? summaryId : undefined,
  };
  // One field names itself after the label; two fields are named "Date"
  // and "Time" inside a group the label names.
  const singleAria = isSplit ? {} : controlAria(aria);
  const singleLabel = isSplit
    ? undefined
    : (singleAria["aria-label"] ??
      (props.label ? undefined : props.placeholder));
  const single = isSplit
    ? {}
    : { id, "aria-description": singleAria["aria-description"] };

  const dateControl = (
    <input
      {...common}
      {...single}
      ref={dateField}
      type="date"
      aria-label={isSplit ? "Date" : singleLabel}
      min={min.date || undefined}
      max={max.date || undefined}
      placeholder={props.placeholder}
      value={parts.date}
      onChange={(event) => write({ ...parts, date: event.target.value })}
      style={{ ...style, flex: "1 1 10em", width: "auto" }}
    />
  );
  const timeField =
    props.timeStep !== undefined ? (
      <select
        {...common}
        {...single}
        ref={slotList}
        aria-label={isSplit ? "Time" : singleLabel}
        aria-invalid={check.invalid || slotOutOfRange || undefined}
        value={parts.time.slice(0, 5)}
        onChange={(event) => write({ ...parts, time: event.target.value })}
        style={{ ...style, ...SELECT_STYLE, flex: "1 1 8em", width: "auto" }}
      >
        <option value="">{props.placeholder ?? "Time"}</option>
        {timeSlots(props.timeStep, timeMin, timeMax, parts.time).map((slot) => (
          <option key={slot} value={slot}>
            {describeDateTime({ date: "", time: slot }, "time") ?? slot}
          </option>
        ))}
      </select>
    ) : (
      <input
        {...common}
        {...single}
        ref={timeInput}
        type="time"
        aria-label={isSplit ? "Time" : singleLabel}
        min={timeMin}
        max={timeMax}
        placeholder={props.placeholder}
        value={parts.time}
        onChange={(event) => write({ ...parts, time: event.target.value })}
        style={{ ...style, flex: "1 1 8em", width: "auto" }}
      />
    );

  return (
    <Field
      label={props.label}
      htmlFor={isSplit ? undefined : id}
      labelId={isSplit ? labelId : undefined}
      weight={props.weight}
      error={check.error ?? rangeError}
      onBlur={check.onBlur}
    >
      <div
        role={isSplit ? "group" : undefined}
        aria-labelledby={isSplit && props.label ? labelId : undefined}
        {...(isSplit ? controlAria(aria) : {})}
        style={{
          display: props.block ? "flex" : "inline-flex",
          flexWrap: "wrap",
          width: props.block ? "100%" : undefined,
          maxWidth: "100%",
          gap: spacing(2),
          alignItems: "center",
        }}
      >
        {mode !== "time" ? dateControl : null}
        {mode !== "date" ? timeField : null}
        {showClear ? (
          <button
            type="button"
            data-a2ui-input=""
            aria-label="Clear"
            onClick={() => write({ date: "", time: "" })}
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
      {summary ? (
        <span
          id={summaryId}
          data-a2ui-datetime-summary=""
          style={{ ...textFont("sm"), color: textColor("secondary") }}
        >
          {summary}
        </span>
      ) : null}
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
  const aria = useGenerativeUIAccessibility();
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
        ...SELECT_STYLE,
        width: props.block === false ? undefined : "100%",
        paddingLeft: props.icon
          ? `${PAD_X[props.size ?? "xl"] + 24}px`
          : undefined,
      }}
      {...controlAria(aria)}
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
  const aria = useGenerativeUIAccessibility();
  const isChecked = Boolean(props.value);
  const hasLabel = props.label !== undefined && props.label !== "";
  const check = useChecks(props.checks, props.value);
  return (
    <span
      {...wrapperAria(aria)}
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
          {...controlAria(aria)}
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
      <CheckError check={check.error} />
    </span>
  );
}

function Radio(props: z.output<typeof radioSchema>) {
  useStandardStyles();
  const aria = useGenerativeUIAccessibility();
  return (
    <label
      {...wrapperAria(aria)}
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
        {...controlAria(aria)}
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
  const aria = useGenerativeUIAccessibility();
  const fallbackName = useId();
  const name = props.name ?? fallbackName;
  const options = normalizeOptions(props.options);
  const value = asText(props.value);
  const variant = props.variant ?? "list";
  const check = useChecks(props.checks, props.value);
  return (
    <fieldset
      {...aria}
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
      <CheckError check={check.error} />
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
  const aria = useGenerativeUIAccessibility();
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
      {...wrapperAria(aria)}
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
        {...controlAria(aria)}
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
      <CheckError check={check.error} />
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
      'A date picker, or a time picker with enableTime, or both. Set timeStep (minutes) to offer fixed times, e.g. 30 for a booking. The value is ISO 8601. Bind value with { "@path": "/x" } to read it. Give it a label.',
    props: dateTimeInputSchema,
    writable: VALUE_WRITABLE,
  },
};
