import React, { useId, useRef, useState } from "react";
import type {
  CatalogRenderers,
  RendererProps,
} from "../../../../create-catalog";
import type { inputDefinitions, OptionList } from "../definitions/inputs";
import { layoutStyle, renderChildren } from "./layout";
import {
  FONT_WEIGHT,
  backgroundColor,
  borderColor,
  radius,
  spacing,
  textColor,
  textFont,
} from "../tokens";
import { ACCENT, useStandardStyles } from "../styles";
import { LucideIcon } from "./media";

/*
 * Bound props are written back with the setter the generic binder adds for
 * every Dynamic* prop: `setValue` for `value`, `setChecked` for `checked`.
 * `action` arrives as a `() => void` that dispatches the A2UI action.
 */

/*
 * Control metrics measured from ChatGPT: inputs (size xl) are 40px tall with
 * ~18.6px side padding and 16px text; buttons (size lg) are 36px tall pills
 * with 16px side padding, 14px/500 text and a 6px icon gap.
 */
type Size = "sm" | "md" | "lg" | "xl";
const HEIGHT: Record<Size, number> = { sm: 28, md: 32, lg: 36, xl: 40 };
/** Control text in em of the host size (13/14/14/16px at a 16px base). */
const FONT_PX: Record<Size, string> = {
  sm: ".8125em",
  md: ".875em",
  lg: ".875em",
  xl: "1em",
};
const PAD_X: Record<Size, number> = { sm: 10, md: 12, lg: 12, xl: 18 };
const ICON_PX: Record<Size, number> = { sm: 14, md: 16, lg: 18, xl: 18 };

const useInputStyles = useStandardStyles;

/** Text inputs use a slightly stronger hairline than cards. */
const CONTROL_BORDER = "var(--a2ui-color-border-control, rgba(0, 0, 0, 0.15))";

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));

function normalizeOptions(options: OptionList) {
  return (Array.isArray(options) ? options : []).map((o) =>
    typeof o === "string"
      ? { value: o, label: o, description: undefined }
      : {
          value: o.value,
          label: o.label ?? o.value,
          description: o.description,
        },
  );
}

function controlStyle(
  p: { size?: Size; pill?: boolean; invalid?: boolean; disabled?: boolean },
  defaultSize: Size,
): React.CSSProperties {
  const size = p.size ?? defaultSize;
  return {
    boxSizing: "border-box",
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    minHeight: HEIGHT[size],
    padding: `0 ${PAD_X[size]}px`,
    fontSize: FONT_PX[size],
    fontFamily: "inherit",
    color: textColor("default"),
    background: backgroundColor("surface"),
    border: `1px solid ${p.invalid ? borderColor("danger") : CONTROL_BORDER}`,
    borderRadius: p.pill === false ? radius("md") : "9999px",
    opacity: p.disabled ? 0.5 : undefined,
  };
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
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
      {label ? (
        <label
          htmlFor={htmlFor}
          style={{
            ...textFont("sm"),
            fontWeight: FONT_WEIGHT.medium,
            color: textColor("secondary"),
          }}
        >
          {label}
        </label>
      ) : null}
      {children}
    </div>
  );
}

function Button({ props, children }: RendererProps<any>) {
  useInputStyles();
  const size: "sm" | "md" | "lg" = props.size ?? "lg";
  const variant: string = props.variant ?? "solid";
  const accent =
    props.color === "danger"
      ? textColor("danger")!
      : props.color === "secondary"
        ? backgroundColor("surface-tertiary")!
        : ACCENT;
  const fg =
    props.color === "danger" ? textColor("danger") : textColor("default");
  const disabled = !!props.disabled || !!props.loading;
  const style: React.CSSProperties = {
    display: props.block ? "flex" : "inline-flex",
    width: props.block ? "100%" : undefined,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    boxSizing: "border-box",
    maxWidth: "100%",
    minHeight: HEIGHT[size],
    minWidth: props.uniform ? HEIGHT[size] : undefined,
    padding: props.uniform ? 0 : `0 ${PAD_X[size] + 4}px`,
    fontSize: FONT_PX[size],
    fontFamily: "inherit",
    fontWeight: FONT_WEIGHT.medium,
    lineHeight: 1,
    borderRadius: props.pill === false ? radius("md") : "9999px",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : undefined,
    ...(variant === "solid"
      ? {
          background: accent,
          color: props.color === "secondary" ? fg : "#fff",
          border: "1px solid transparent",
        }
      : variant === "soft"
        ? {
            background: backgroundColor("surface-secondary"),
            color: fg,
            border: "1px solid transparent",
          }
        : variant === "outline"
          ? {
              background: "transparent",
              color: fg,
              border: `1px solid ${props.color === "danger" ? accent : borderColor("default")}`,
            }
          : { background: "transparent", color: fg, border: "none" }),
  };
  return (
    <button
      data-a2ui-input=""
      type={props.submit ? "submit" : "button"}
      disabled={disabled}
      aria-busy={props.loading ? true : undefined}
      style={style}
      onClick={(e) => {
        // Nested inside a Pressable/ListItem: only the innermost action fires.
        e.stopPropagation();
        // A submit button inside a <form> lets the Form dispatch on submit;
        // outside a form it falls back to its own action.
        if (props.submit && e.currentTarget.form) return;
        props.action?.();
      }}
    >
      {props.icon ? (
        <span aria-hidden data-icon={props.icon} style={{ display: "flex" }}>
          <LucideIcon name={props.icon} size={ICON_PX[size]} />
        </span>
      ) : null}
      {props.children?.length
        ? renderChildren(props.children, children)
        : str(props.label ?? props.text)}
    </button>
  );
}

function TextField({ props }: RendererProps<any>) {
  useInputStyles();
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
        required={props.required}
        disabled={props.disabled}
        aria-invalid={props.invalid || undefined}
        value={str(props.value)}
        onFocus={props.autoSelect ? () => ref.current?.select() : undefined}
        onChange={(e) => props.setValue?.(e.target.value)}
        style={controlStyle(props, "xl")}
      />
    </Field>
  );
}

function TextArea({ props }: RendererProps<any>) {
  useInputStyles();
  const id = useId();
  const size: Size = props.size ?? "xl";
  return (
    <Field label={props.label} htmlFor={id}>
      <textarea
        id={id}
        data-a2ui-input=""
        name={props.name}
        placeholder={props.placeholder}
        required={props.required}
        disabled={props.disabled}
        aria-invalid={props.invalid || undefined}
        rows={props.rows ?? 3}
        value={str(props.value)}
        onChange={(e) => {
          props.setValue?.(e.target.value);
          if (props.autoResize) {
            const el = e.target;
            el.style.height = "auto";
            el.style.height = `${el.scrollHeight}px`;
          }
        }}
        style={{
          ...controlStyle({ ...props, pill: false }, size),
          padding: `${PAD_X[size] / 2}px ${PAD_X[size]}px`,
          resize: props.autoResize ? "none" : "vertical",
          maxHeight: props.maxRows
            ? `calc(${props.maxRows} * 1.5em + ${PAD_X[size]}px)`
            : undefined,
          lineHeight: 1.5,
        }}
      />
    </Field>
  );
}

function Select({ props }: RendererProps<any>) {
  useInputStyles();
  const id = useId();
  const options = normalizeOptions(props.options);
  const value = str(props.value);
  return (
    <Field label={props.label} htmlFor={id}>
      <select
        id={id}
        data-a2ui-input=""
        name={props.name}
        required={props.required}
        disabled={props.disabled}
        value={value}
        onChange={(e) => props.setValue?.(e.target.value)}
        style={controlStyle(props, "xl")}
      >
        {props.placeholder || props.clearable || !value ? (
          <option value="">{props.placeholder ?? ""}</option>
        ) : null}
        {options.map((o) => (
          <option key={o.value} value={o.value} title={o.description}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

function CheckBox({ props }: RendererProps<any>) {
  useInputStyles();
  const checked = !!props.checked;
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
        required={props.required}
        disabled={props.disabled}
        checked={checked}
        onChange={(e) => props.setChecked?.(e.target.checked)}
      />
      {props.label != null && props.label !== "" ? (
        <span
          style={{
            textDecoration:
              props.lineThrough && checked ? "line-through" : undefined,
          }}
        >
          {str(props.label)}
        </span>
      ) : null}
    </label>
  );
}

function Radio({ props }: RendererProps<any>) {
  useInputStyles();
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

function RadioGroup({ props }: RendererProps<any>) {
  useInputStyles();
  const fallbackName = useId();
  const name = props.name ?? fallbackName;
  const options = normalizeOptions(props.options);
  const value = str(props.value);
  const variant: string = props.variant ?? "list";
  return (
    <fieldset
      disabled={props.disabled}
      style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
    >
      {props.label ? (
        <legend
          style={{
            ...textFont("sm"),
            fontWeight: FONT_WEIGHT.medium,
            color: textColor("secondary"),
            padding: 0,
            marginBottom: spacing(1),
          }}
        >
          {props.label}
        </legend>
      ) : null}
      <div
        style={{
          display: "flex",
          flexDirection:
            (props.direction ?? "row") === "col" ? "column" : "row",
          flexWrap: "wrap",
          gap: spacing(variant === "list" ? 3 : 2),
        }}
      >
        {options.map((o) => {
          const selected = o.value === value;
          const boxed = variant === "pills" || variant === "cards";
          return (
            <label
              key={o.value}
              style={{
                display: "inline-flex",
                alignItems: variant === "cards" ? "flex-start" : "center",
                gap: spacing(2),
                cursor: "pointer",
                ...textFont("md"),
                ...(boxed
                  ? {
                      padding:
                        variant === "cards" ? spacing(3) : `4px ${spacing(3)}`,
                      border: `1px solid ${selected ? ACCENT : borderColor("default")}`,
                      borderRadius:
                        variant === "pills" ? "9999px" : radius("lg"),
                    }
                  : {}),
              }}
            >
              <input
                type="radio"
                data-a2ui-input=""
                name={name}
                value={o.value}
                required={props.required}
                checked={selected}
                onChange={() => props.setValue?.(o.value)}
                className="a2ui-std-check"
              />
              <span style={{ display: "flex", flexDirection: "column" }}>
                <span>{o.label}</span>
                {o.description ? (
                  <span
                    style={{ ...textFont("sm"), color: textColor("secondary") }}
                  >
                    {o.description}
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

function Slider({ props }: RendererProps<any>) {
  useInputStyles();
  const id = useId();
  const listId = useId();
  const value =
    typeof props.value === "number"
      ? props.value
      : Number(props.value ?? props.min ?? 0);
  const marks: Array<{ value: number; label?: string }> = Array.isArray(
    props.marks,
  )
    ? props.marks
    : [];
  const discrete = props.sliderStyle === "discrete";
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
          {props.label || props.unit
            ? `${value}${props.unit ? ` ${props.unit}` : ""}`
            : null}
        </span>
      </div>
      <input
        id={id}
        type="range"
        className="a2ui-std-range"
        data-a2ui-input=""
        name={props.name}
        min={props.min ?? 0}
        max={props.max ?? 100}
        step={props.step ?? 1}
        disabled={props.disabled}
        value={value}
        list={discrete && marks.length ? listId : undefined}
        onChange={(e) => props.setValue?.(Number(e.target.value))}
      />
      {marks.length ? (
        <>
          <datalist id={listId}>
            {marks.map((m) => (
              <option key={m.value} value={m.value} label={m.label} />
            ))}
          </datalist>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: spacing(2),
              fontSize: ".875em",
              lineHeight: 1.3,
              color: textColor("secondary"),
            }}
          >
            {marks.map((m) => (
              <span key={m.value}>{m.label ?? m.value}</span>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function SegmentedControl({ props }: RendererProps<any>) {
  useInputStyles();
  const size: Size = props.size ?? "lg";
  const options = normalizeOptions(props.options);
  const value = str(props.value);
  const pill = props.pill !== false;
  const variant: string = props.variant ?? "ghost";
  return (
    <Field label={props.label}>
      <div
        role="radiogroup"
        aria-label={props.label}
        style={{
          display: props.block ? "flex" : "inline-flex",
          width: props.block ? "100%" : undefined,
          gap: 2,
          padding: 2,
          boxSizing: "border-box",
          background: backgroundColor("surface-secondary"),
          border:
            variant === "outline"
              ? `1px solid ${borderColor("default")}`
              : undefined,
          borderRadius: pill ? "9999px" : radius("md"),
          opacity: props.disabled ? 0.5 : undefined,
        }}
      >
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              data-a2ui-input=""
              disabled={props.disabled}
              onClick={(e) => {
                e.stopPropagation();
                props.setValue?.(o.value);
              }}
              style={{
                flex: props.block ? 1 : undefined,
                minHeight: HEIGHT[size] - 4,
                padding: `0 ${PAD_X[size]}px`,
                fontSize: FONT_PX[size],
                fontFamily: "inherit",
                fontWeight: FONT_WEIGHT.medium,
                border: "none",
                cursor: props.disabled ? "not-allowed" : "pointer",
                borderRadius: pill ? "9999px" : radius("sm"),
                background: selected
                  ? variant === "solid"
                    ? ACCENT
                    : backgroundColor("surface")
                  : "transparent",
                color: selected
                  ? variant === "solid"
                    ? "#fff"
                    : textColor("default")
                  : textColor("secondary"),
                boxShadow:
                  selected && variant !== "solid"
                    ? "0 1px 2px rgba(0,0,0,.12)"
                    : undefined,
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </Field>
  );
}

function DateTimeInput({ props }: RendererProps<any>) {
  useInputStyles();
  const id = useId();
  const value = str(props.value);
  return (
    <Field label={props.label} htmlFor={id}>
      <div style={{ display: "flex", gap: spacing(2), alignItems: "center" }}>
        <input
          id={id}
          type="date"
          data-a2ui-input=""
          min={props.min}
          max={props.max}
          placeholder={props.placeholder}
          disabled={props.disabled}
          required={props.required}
          value={value}
          onChange={(e) => props.setValue?.(e.target.value)}
          style={controlStyle(props, "xl")}
        />
        {props.clearable && value ? (
          <button
            type="button"
            aria-label="Clear date"
            onClick={() => props.setValue?.("")}
            style={{
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: textColor("secondary"),
            }}
          >
            ×
          </button>
        ) : null}
      </div>
    </Field>
  );
}

function Pressable({ props, children }: RendererProps<any>) {
  const disabled = !!props.disabled;
  const [hover, setHover] = useState(false);
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      data-a2ui-input=""
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) props.action?.();
      }}
      onKeyDown={(e) => {
        // Keys pressed on a nested control (Button, input) belong to it.
        if (e.target !== e.currentTarget) return;
        if (!disabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          props.action?.();
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        flexDirection: "column",
        ...layoutStyle(props),
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : undefined,
        ...(hover && props.hoverBackground && !disabled
          ? { background: backgroundColor(props.hoverBackground) }
          : {}),
      }}
    >
      {renderChildren(props.children, children)}
    </div>
  );
}

export const inputRenderers = {
  Button,
  Pressable,
  Form: ({ props, children }: RendererProps<any>) => (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        props.action?.();
      }}
      style={{
        flexDirection: "column",
        ...layoutStyle(props),
        gap: spacing(props.gap ?? 4),
      }}
    >
      {renderChildren(props.children, children)}
    </form>
  ),
  TextField,
  TextArea,
  Select,
  CheckBox,
  Radio,
  RadioGroup,
  Slider,
  SegmentedControl,
  DateTimeInput,
} satisfies CatalogRenderers<typeof inputDefinitions>;
