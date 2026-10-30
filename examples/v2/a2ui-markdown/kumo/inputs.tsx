"use client";

import { useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  Button as KumoButton,
  Checkbox as KumoCheckbox,
  Combobox,
  Field,
  Input,
  InputArea,
  LinkButton,
  Select as KumoSelect,
} from "@cloudflare/kumo";
import { Form as BaseForm } from "@cloudflare/kumo/primitives/form";
import { useGenerativeUIAccessibility } from "@copilotkit/react-core/v2/generative-ui";
import { firstFailedCheck, useChecks } from "./checks";
import { usePhosphorIcon } from "./icons";
import { safeHref } from "./inline-markdown";
import { defined, layoutStyle, sizeOf } from "./style";
import { standardComponent } from "./types";
import type { StandardProps } from "./types";

type KumoButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "destructive"
  | "secondary-destructive";
type KumoSize = "xs" | "sm" | "base" | "lg";

/**
 * The Kumo Button variant of a standard variant and color. The standard
 * default is an outlined button, which is Kumo's "secondary".
 */
export function buttonVariantOf(
  variant: StandardProps<"Button">["variant"],
  color: StandardProps<"Button">["color"],
): KumoButtonVariant {
  if (color === "danger")
    return variant === "primary" ? "destructive" : "secondary-destructive";
  if (variant === "primary")
    return color === "secondary" ? "secondary" : "primary";
  if (variant === "borderless") return "ghost";
  return "secondary";
}

/** The Kumo size of a standard button size. The default "lg" is Kumo's "base". */
export function buttonSizeOf(size: StandardProps<"Button">["size"]): KumoSize {
  if (size === "md") return "sm";
  if (size === "sm") return "xs";
  return "base";
}

/**
 * The Kumo size of a standard field size. The defaults ("lg" for a
 * TextField, "xl" for a TextArea and a Select) are Kumo's "base".
 */
export function fieldSizeOf(
  size: "sm" | "md" | "lg" | "xl" | undefined,
): KumoSize {
  if (size === "md") return "sm";
  if (size === "sm") return "xs";
  return "base";
}

type TextFieldVariant = StandardProps<"TextField">["variant"];

/** The input type of a TextField variant. */
export function inputTypeOf(
  variant: TextFieldVariant,
): "text" | "number" | "email" | "url" | "tel" | "password" | "textarea" {
  switch (variant) {
    case "number":
    case "email":
    case "url":
    case "tel":
      return variant;
    case "obscured":
      return "password";
    case "longText":
      return "textarea";
    default:
      return "text";
  }
}

/** A slot that holds content: a filled list or a node. */
function hasContent(children: ReactNode) {
  if (Array.isArray(children)) return children.length > 0;
  return children !== undefined && children !== null;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const ICON_PX: Record<KumoSize, number> = { xs: 12, sm: 14, base: 16, lg: 18 };

const StandardIcon = standardComponent("Icon");

/**
 * Button: a Kumo Button, or a Kumo LinkButton when it opens a URL. A
 * failing error check disables it, like the standard Button.
 */
export function Button(props: StandardProps<"Button">) {
  const aria = useGenerativeUIAccessibility();
  const [isCopied, setIsCopied] = useState(false);
  const size = buttonSizeOf(props.size);
  const variant = buttonVariantOf(props.variant, props.color);
  const failed = firstFailedCheck(props.checks);
  const isDisabled = Boolean(
    props.disabled || props.loading || failed?.severity === "error",
  );
  const iconName = isCopied ? "check" : props.icon;
  const IconComponent = usePhosphorIcon(iconName);
  // A name Phosphor does not have falls back to the standard (lucide) Icon.
  // The wrapper hides it: the button already says what it does.
  const icon = IconComponent ? (
    <IconComponent size={ICON_PX[size]} aria-hidden />
  ) : IconComponent === undefined && iconName ? (
    <span aria-hidden style={{ display: "inline-flex" }}>
      <StandardIcon name={iconName} size={ICON_PX[size]} />
    </span>
  ) : undefined;
  const label = props.label ?? props.text;
  const content = hasContent(props.child)
    ? props.child
    : hasContent(props.children)
      ? props.children
      : label;
  const style: CSSProperties = defined({
    width: props.block ? "100%" : undefined,
    flexGrow: props.weight,
    borderRadius: props.pill ? "9999px" : undefined,
  });
  const href = props.href ? safeHref(props.href) : undefined;
  if (href && !isDisabled) {
    return (
      <LinkButton
        {...aria}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        variant={variant}
        size={size}
        icon={icon}
        style={style}
      >
        {content}
      </LinkButton>
    );
  }
  const onClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (props.submit && event.currentTarget.form !== null) return;
    if (props.copy) {
      const text = props.copy;
      void copyText(text).then((isOk) => {
        if (!isOk) return;
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 1500);
      });
      return;
    }
    void props.onClick?.({});
  };
  if (props.uniform && label) {
    return (
      <KumoButton
        {...aria}
        type={props.submit ? "submit" : "button"}
        shape="square"
        aria-label={label}
        variant={variant}
        size={size}
        icon={icon}
        loading={props.loading}
        disabled={isDisabled}
        title={failed?.message ?? label}
        style={style}
        onClick={onClick}
      />
    );
  }
  return (
    <KumoButton
      {...aria}
      type={props.submit ? "submit" : "button"}
      variant={variant}
      size={size}
      icon={icon}
      loading={props.loading}
      disabled={isDisabled}
      title={failed?.message}
      style={style}
      onClick={onClick}
    >
      {content}
    </KumoButton>
  );
}

/** Form: the Base UI Form that Kumo re-exports. It sends onSubmit({}). */
export function Form(props: StandardProps<"Form">) {
  return (
    <BaseForm
      aria-label={props.label}
      onSubmit={(event) => {
        event.preventDefault();
        void props.onSubmit?.({});
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        ...layoutStyle(props),
        gap: sizeOf(props.gap ?? 4),
      }}
    >
      {props.children}
    </BaseForm>
  );
}

const asText = (value: unknown) =>
  value === undefined || value === null ? "" : String(value);

/** TextArea: a Kumo InputArea. */
export function TextArea(props: StandardProps<"TextArea">) {
  const aria = useGenerativeUIAccessibility();
  const check = useChecks(props.checks, props.value);
  return (
    <div style={{ flexGrow: props.weight, minWidth: 0 }} onBlur={check.onBlur}>
      <InputArea
        {...aria}
        label={props.label}
        aria-label={props.label ? undefined : props.placeholder}
        placeholder={props.placeholder}
        name={props.name}
        required={props.required}
        disabled={props.disabled}
        size={fieldSizeOf(props.size)}
        aria-invalid={props.invalid || check.invalid || undefined}
        error={check.error?.message}
        minRows={props.rows ?? 3}
        maxRows={props.maxRows}
        autoResize={props.autoResize}
        value={asText(props.value)}
        onChange={(event) => props.setValue(event.target.value)}
      />
    </div>
  );
}

/**
 * TextField: a Kumo Input. "obscured" is a password Input,
 * "longText" a Kumo InputArea. The standard TextField ignores `mask`, and
 * so does this one.
 */
export function TextField(props: StandardProps<"TextField">) {
  const aria = useGenerativeUIAccessibility();
  const ref = useRef<HTMLInputElement>(null);
  const check = useChecks(props.checks, props.value);
  const type = inputTypeOf(props.variant);
  if (type === "textarea") {
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
  const common = {
    label: props.label,
    placeholder: props.placeholder,
    name: props.name,
    required: props.required,
    disabled: props.disabled,
    size: fieldSizeOf(props.size),
    "aria-invalid": props.invalid || check.invalid || undefined,
    error: check.error?.message,
  };
  return (
    <div style={{ flexGrow: props.weight, minWidth: 0 }} onBlur={check.onBlur}>
      {
        // "obscured" is a masked Kumo Input. Kumo's SensitiveInput shows
        // the value once the user types, which a password field must not.
        <Input
          {...aria}
          {...common}
          ref={ref}
          type={type}
          aria-label={props.label ? undefined : props.placeholder}
          value={asText(props.value)}
          onFocus={props.autoSelect ? () => ref.current?.select() : undefined}
          onChange={(event) => props.setValue(event.target.value)}
        />
      }
    </div>
  );
}

/** The value and label of each option of an option list. */
function optionsOf(options: StandardProps<"Select">["options"]) {
  return (options ?? []).map((option) =>
    typeof option === "string"
      ? { value: option, label: option }
      : { value: option.value, label: option.label ?? option.value },
  );
}

/**
 * Select: a Kumo Select, or a Kumo Combobox when it is searchable or
 * clearable (Kumo's Select can do neither).
 */
export function Select(props: StandardProps<"Select">) {
  const aria = useGenerativeUIAccessibility();
  const check = useChecks(props.checks, props.value);
  const options = optionsOf(props.options);
  const labels = Object.fromEntries(
    options.map((option) => [option.value, option.label]),
  );
  const style: CSSProperties = {
    width: props.block ? "100%" : undefined,
    minWidth: 0,
  };
  if (props.searchable || props.clearable) {
    return (
      <div style={style} onBlur={check.onBlur}>
        <Field
          label={props.label}
          error={
            check.error
              ? { message: check.error.message, match: true }
              : undefined
          }
        >
          <Combobox
            {...aria}
            items={options.map((option) => option.value)}
            value={props.value ?? null}
            onValueChange={(value) =>
              props.setValue((value as string | null) ?? "")
            }
            itemToStringLabel={(value: string) => labels[value] ?? value}
          >
            <Combobox.TriggerInput placeholder={props.placeholder} />
            <Combobox.Content>
              <Combobox.Empty />
              <Combobox.List>
                {(value: string) => (
                  <Combobox.Item key={value} value={value}>
                    {labels[value] ?? value}
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Content>
          </Combobox>
        </Field>
      </div>
    );
  }
  return (
    <div style={style} onBlur={check.onBlur}>
      <KumoSelect
        {...aria}
        label={props.label}
        placeholder={props.placeholder}
        name={props.name}
        required={props.required}
        disabled={props.disabled}
        size={fieldSizeOf(props.size)}
        error={check.error?.message}
        items={labels}
        value={props.value ?? null}
        onValueChange={(value) =>
          props.setValue((value as string | null) ?? "")
        }
      />
    </div>
  );
}

/** CheckBox: a Kumo Checkbox. Kumo has no round checkbox. */
export function CheckBox(props: StandardProps<"CheckBox">) {
  const aria = useGenerativeUIAccessibility();
  const check = useChecks(props.checks, props.value);
  const isChecked = props.value === true;
  return (
    <div
      style={defined({
        flexGrow: props.weight,
        textDecoration:
          props.lineThrough && isChecked ? "line-through" : undefined,
      })}
      onBlur={check.onBlur}
    >
      <KumoCheckbox
        {...aria}
        label={props.label}
        name={props.name}
        required={props.required}
        disabled={props.disabled}
        variant={check.invalid ? "error" : "default"}
        checked={isChecked}
        onCheckedChange={(checked) => props.setValue(checked === true)}
      />
      {check.error ? (
        <p style={{ color: "var(--text-color-kumo-danger)", fontSize: "13px" }}>
          {check.error.message}
        </p>
      ) : null}
    </div>
  );
}

export const inputOverrides = {
  Button: { component: Button },
  Form: { component: Form },
  TextField: { component: TextField },
  TextArea: { component: TextArea },
  Select: { component: Select },
  CheckBox: { component: CheckBox },
};
