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
} from "./layout";
import { openUrl } from "./lightbox";
import { LucideIcon } from "./media";

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
  text: z
    .string()
    .optional()
    .describe("Same as label. Used when label is not set"),
  variant: z
    .enum(["solid", "soft", "outline", "ghost"])
    .optional()
    .describe('Default "solid"'),
  color: z
    .enum(["primary", "secondary", "danger"])
    .optional()
    .describe('Default "primary"'),
  size: z.enum(["sm", "md", "lg"]).optional().describe('Default "lg"'),
  block: z.boolean().optional().describe("Full width"),
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
  value: z
    .union([z.string(), z.number()])
    .optional()
    .describe('Bind it with { "@path": "/x" } to read what the user typed'),
  placeholder: z.string().optional(),
  label: fieldLabel,
  inputType: z
    .enum(["text", "number", "email", "password", "url", "tel"])
    .optional()
    .describe('Default "text"'),
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
  value: boundValue,
  placeholder: z.string().optional(),
  label: fieldLabel,
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
  checked: z
    .boolean()
    .optional()
    .describe(
      'Bind this (not value) with { "@path": "/x" } to read the state of the box',
    ),
  label: z.string().optional().describe("The label text. Always set it"),
  name: z.string().optional(),
  value: z.string().optional().describe('The form value. Default "on"'),
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
  value: z
    .number()
    .optional()
    .describe('Bind it with { "@path": "/x" } to read the number'),
  min: z.number().optional().describe("Default 0"),
  max: z.number().optional().describe("Default 100"),
  step: z.number().optional().describe("Default 1"),
  label: fieldLabel,
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
const dateTimeInputSchema = z.object({
  value: z
    .string()
    .optional()
    .describe('"YYYY-MM-DD". Bind it with { "@path": "/x" }'),
  label: fieldLabel,
  min: z.string().optional().describe('The earliest date, "YYYY-MM-DD"'),
  max: z.string().optional().describe('The latest date, "YYYY-MM-DD"'),
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
  children,
}: {
  label?: string;
  htmlFor?: string;
  labelId?: string;
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
      }}
    >
      {label ? labelElement : null}
      {children}
    </div>
  );
}

// ---- Button ----

type ButtonProps = WithChildren<
  z.output<typeof buttonSchema> & { onClick?: EventProp }
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
    case "solid":
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
    case "outline":
      return {
        background: "transparent",
        color: foreground,
        border: `1px solid ${color === "danger" ? accent : borderColor("default")}`,
      };
    case "ghost":
      return { background: "transparent", color: foreground, border: "none" };
  }
}

function Button(props: ButtonProps) {
  useStandardStyles();
  const [isCopied, setIsCopied] = useState(false);
  const buttonSize = props.size ?? "lg";
  const isDisabled = Boolean(props.disabled || props.loading);
  const style: CSSProperties = {
    display: props.block ? "flex" : "inline-flex",
    width: props.block ? "100%" : undefined,
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
    ...buttonVariantStyle(props.variant ?? "solid", props.color),
  };
  return (
    <button
      data-a2ui-input=""
      type={props.submit ? "submit" : "button"}
      disabled={isDisabled}
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
      {hasContent(props.children)
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

function TextField(props: TextFieldProps) {
  useStandardStyles();
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  return (
    <Field label={props.label} htmlFor={id}>
      <input
        ref={ref}
        id={id}
        data-a2ui-input=""
        type={props.inputType ?? "text"}
        name={props.name}
        placeholder={props.placeholder}
        // Without a visible label, the placeholder still names the field.
        aria-label={props.label ? undefined : props.placeholder}
        required={props.required}
        disabled={props.disabled}
        aria-invalid={props.invalid || undefined}
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
  return (
    <Field label={props.label} htmlFor={id}>
      <textarea
        id={id}
        data-a2ui-input=""
        name={props.name}
        placeholder={props.placeholder}
        aria-label={props.label ? undefined : props.placeholder}
        required={props.required}
        disabled={props.disabled}
        aria-invalid={props.invalid || undefined}
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

function DateTimeInput(props: DateTimeInputProps) {
  useStandardStyles();
  const id = useId();
  const value = asText(props.value);
  const showClear = props.clearable && value !== "";
  return (
    <Field label={props.label} htmlFor={id}>
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
          type="date"
          data-a2ui-input=""
          min={props.min}
          max={props.max}
          placeholder={props.placeholder}
          aria-label={props.label ? undefined : props.placeholder}
          disabled={props.disabled}
          required={props.required}
          value={value}
          onChange={(event) => props.setValue(event.target.value)}
          style={controlStyle(props, "xl")}
        />
        {showClear ? (
          <button
            type="button"
            data-a2ui-input=""
            aria-label="Clear date"
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

type SelectProps = z.output<typeof selectSchema> & {
  setValue: (value: string) => void;
};

function Select(props: SelectProps) {
  useStandardStyles();
  const id = useId();
  const options = normalizeOptions(props.options);
  const value = asText(props.value);
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
    <Field label={props.label} htmlFor={id}>
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
  setChecked: (checked: boolean) => void;
};

function CheckBox(props: CheckBoxProps) {
  useStandardStyles();
  const isChecked = Boolean(props.checked);
  const hasLabel = props.label !== undefined && props.label !== "";
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
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
        value={props.value ?? "on"}
        aria-label={hasLabel ? undefined : props.name}
        required={props.required}
        disabled={props.disabled}
        checked={isChecked}
        onChange={(event) => props.setChecked(event.target.checked)}
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
  return (
    <fieldset
      disabled={props.disabled}
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
    <Field label={props.label} labelId={labelId}>
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
  const value = props.value ?? props.min ?? 0;
  const marks = props.marks ?? [];
  const isDiscrete = props.sliderStyle === "discrete";
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
      }}
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
        min={props.min ?? 0}
        max={props.max ?? 100}
        step={props.step ?? 1}
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
 * - The value of a control is writable: `value` (`checked` for CheckBox).
 *   When the model binds it to `{ "@path": "/x" }`, what the user enters goes
 *   into the data model at that path, and the agent can no longer change it.
 */
export const inputComponents = {
  Button: {
    component: Button,
    description:
      'A button that sends its onClick event. With href it opens the URL, and with copy it copies the text, both without the agent. Use one primary Button in a Row, and variant "ghost" for the others. With submit true inside a Form, it submits the Form. Children render instead of the label.',
    props: buttonSchema,
    events: {
      onClick: {
        description: "Sent when the user clicks the button.",
        parameters: NO_ARGS,
      },
    },
    slots: CHILDREN_SLOT,
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
      'A single-line text input. Bind value with { "@path": "/x" } to read what the user typed. Give it a label.',
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
      'A checkbox with a label. Bind checked (not value) with { "@path": "/x" } to read its state.',
    props: checkBoxSchema,
    writable: ["checked"] as const,
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
  DateTimeInput: {
    component: DateTimeInput,
    description:
      'A date picker. The value is "YYYY-MM-DD". Bind value with { "@path": "/x" } to read the date. Give it a label.',
    props: dateTimeInputSchema,
    writable: VALUE_WRITABLE,
  },
};
