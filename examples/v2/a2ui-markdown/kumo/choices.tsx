"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  Button as KumoButton,
  Checkbox as KumoCheckbox,
  Combobox,
  DatePicker,
  Field,
  Input,
  Label as KumoLabel,
  Popover,
  Radio as KumoRadio,
  Slider as KumoSlider,
  Text as KumoText,
} from "@cloudflare/kumo";
import { useGenerativeUIAccessibility } from "@copilotkit/react-core/v2/generative-ui";
import { useChecks } from "./checks";
import { usePhosphorIcon } from "./icons";
import { defined } from "./style";
import type { StandardProps } from "./types";

type OptionList = StandardProps<"RadioGroup">["options"];

/** The value and label of each option of an option list. */
function optionsOf(options: OptionList) {
  return (options ?? []).map((option) =>
    typeof option === "string"
      ? { value: option, label: option, description: undefined }
      : {
          value: option.value,
          label: option.label ?? option.value,
          description: option.description,
        },
  );
}

/** A failed check under a group of controls, in Kumo's danger color. */
function CheckMessage({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <KumoText variant="error" size="sm">
      {message}
    </KumoText>
  );
}

// ---- Radio, RadioGroup, SegmentedControl ----

/** The Kumo Radio appearance of a RadioGroup variant. */
export function radioAppearanceOf(
  variant: StandardProps<"RadioGroup">["variant"],
): "default" | "card" | "segmented" {
  if (variant === "cards") return "card";
  if (variant === "pills") return "segmented";
  return "default";
}

/**
 * Radio: one Kumo Radio item. Kumo has no radio outside a group, so it is a
 * group of one. Like the standard Radio, it keeps no value.
 */
export function Radio(props: StandardProps<"Radio">) {
  const aria = useGenerativeUIAccessibility();
  return (
    <KumoRadio {...aria} disabled={props.disabled}>
      <KumoRadio.Item
        value={props.value ?? ""}
        label={props.label ?? props.value ?? ""}
        disabled={props.disabled}
      />
    </KumoRadio>
  );
}

/** RadioGroup: a Kumo Radio group. */
export function RadioGroup(props: StandardProps<"RadioGroup">) {
  const aria = useGenerativeUIAccessibility();
  const check = useChecks(props.checks, props.value);
  return (
    <div onBlur={check.onBlur}>
      <KumoRadio
        {...aria}
        legend={props.label}
        name={props.name}
        orientation={props.direction === "col" ? "vertical" : "horizontal"}
        appearance={radioAppearanceOf(props.variant)}
        disabled={props.disabled}
        error={check.error?.message}
        value={props.value ?? ""}
        onValueChange={(value) => props.setValue(String(value))}
      >
        {optionsOf(props.options).map((option) => (
          <KumoRadio.Item
            key={option.value}
            value={option.value}
            label={option.label}
            description={option.description}
          />
        ))}
      </KumoRadio>
    </div>
  );
}

/** SegmentedControl: a Kumo Radio group in the "segmented" appearance. */
export function SegmentedControl(props: StandardProps<"SegmentedControl">) {
  const aria = useGenerativeUIAccessibility();
  const check = useChecks(props.checks, props.value);
  return (
    <div
      onBlur={check.onBlur}
      style={defined({ width: props.block ? "100%" : undefined })}
    >
      <KumoRadio
        {...aria}
        legend={props.label}
        orientation="horizontal"
        appearance="segmented"
        disabled={props.disabled}
        error={check.error?.message}
        value={props.value ?? ""}
        onValueChange={(value) => props.setValue(String(value))}
      >
        {optionsOf(props.options).map((option) => (
          <KumoRadio.Item
            key={option.value}
            value={option.value}
            label={option.label}
          />
        ))}
      </KumoRadio>
    </div>
  );
}

// ---- Slider ----

/** The step of a Slider: `steps` divide the range, else `step`, else 1. */
export function sliderStepOf(props: {
  min?: number;
  max?: number;
  step?: number;
  steps?: number;
}) {
  const min = props.min ?? 0;
  const max = props.max ?? 100;
  return props.steps ? (max - min) / props.steps : (props.step ?? 1);
}

/**
 * Slider: a Kumo Slider. The label shows the value and its unit, like the
 * standard Slider. Kumo draws no marks, so their labels sit under it.
 */
export function Slider(props: StandardProps<"Slider">) {
  const aria = useGenerativeUIAccessibility();
  const check = useChecks(props.checks, props.value);
  const min = props.min ?? 0;
  const max = props.max ?? 100;
  const value = props.value ?? min;
  const valueText = props.unit ? `${value} ${props.unit}` : `${value}`;
  const showValue = Boolean(props.label || props.unit);
  const marks = props.marks ?? [];
  return (
    <div onBlur={check.onBlur} style={{ flexGrow: props.weight, minWidth: 0 }}>
      <KumoSlider
        {...aria}
        label={
          showValue ? (
            <span
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "8px",
                width: "100%",
              }}
            >
              <span>{props.label}</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                {valueText}
              </span>
            </span>
          ) : undefined
        }
        getAriaLabel={props.label ? () => props.label as string : undefined}
        name={props.name}
        min={min}
        max={max}
        step={sliderStepOf(props)}
        disabled={props.disabled}
        value={value}
        onValueChange={(next) =>
          props.setValue(Array.isArray(next) ? next[0] : (next as number))
        }
      />
      {/* Kumo prints the min and max under the track itself. */}
      {marks.length > 0 ? (
        <div style={{ position: "relative", height: "18px", marginTop: "4px" }}>
          {marks
            .filter((mark) => mark.value !== min && mark.value !== max)
            .map((mark) => (
              <span
                key={mark.value}
                style={{
                  position: "absolute",
                  left: `${((mark.value - min) / (max - min || 1)) * 100}%`,
                  transform: "translateX(-50%)",
                }}
              >
                <KumoText variant="secondary" size="xs">
                  {mark.label ?? String(mark.value)}
                </KumoText>
              </span>
            ))}
        </div>
      ) : null}
      <CheckMessage message={check.error?.message} />
    </div>
  );
}

// ---- ChoicePicker ----

export type ChoiceKind = "combobox" | "chips" | "checkboxes" | "radios";

/** How a ChoicePicker is drawn. `filterable` wins over the display style. */
export function choiceKindOf(props: {
  variant?: StandardProps<"ChoicePicker">["variant"];
  displayStyle?: StandardProps<"ChoicePicker">["displayStyle"];
  filterable?: boolean;
}): ChoiceKind {
  if (props.filterable) return "combobox";
  if (props.displayStyle === "chips") return "chips";
  if (props.variant === "multipleSelection") return "checkboxes";
  return "radios";
}

/**
 * ChoicePicker: a Kumo Combobox (filterable), toggle Kumo Buttons (chips),
 * a Kumo Checkbox group (several choices) or a Kumo Radio group (one).
 */
export function ChoicePicker(props: StandardProps<"ChoicePicker">) {
  const aria = useGenerativeUIAccessibility();
  const check = useChecks(props.checks, props.value);
  const options = optionsOf(props.options);
  const labels = Object.fromEntries(
    options.map((option) => [option.value, option.label]),
  );
  const chosen = props.value ?? [];
  const isMultiple = props.variant === "multipleSelection";
  const toggle = (value: string) => {
    if (!isMultiple) return props.setValue([value]);
    props.setValue(
      chosen.includes(value)
        ? chosen.filter((item) => item !== value)
        : [...chosen, value],
    );
  };
  const kind = choiceKindOf(props);
  let control;
  if (kind === "combobox") {
    control = (
      <Field label={props.label}>
        <Combobox
          {...aria}
          items={options.map((option) => option.value)}
          multiple={isMultiple}
          value={isMultiple ? chosen : (chosen[0] ?? null)}
          onValueChange={(value) =>
            props.setValue(
              Array.isArray(value)
                ? (value as string[])
                : value === null
                  ? []
                  : [value as string],
            )
          }
          itemToStringLabel={(value: string) => labels[value] ?? value}
        >
          {isMultiple ? (
            <Combobox.TriggerMultipleWithInput
              renderItem={(value: string) => (
                <Combobox.Chip key={value}>
                  {labels[value] ?? value}
                </Combobox.Chip>
              )}
              inputSide="right"
            />
          ) : (
            <Combobox.TriggerInput />
          )}
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
    );
  } else if (kind === "chips") {
    control = (
      <div role="group" aria-label={props.label} {...aria}>
        {props.label ? <KumoLabel>{props.label}</KumoLabel> : null}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "8px",
            marginTop: "6px",
          }}
        >
          {options.map((option) => {
            const isChosen = chosen.includes(option.value);
            return (
              <KumoButton
                key={option.value}
                type="button"
                size="sm"
                variant={isChosen ? "primary" : "secondary"}
                aria-pressed={isChosen}
                disabled={props.disabled}
                onClick={() => toggle(option.value)}
              >
                {option.label}
              </KumoButton>
            );
          })}
        </div>
      </div>
    );
  } else if (kind === "checkboxes") {
    control = (
      <KumoCheckbox.Group
        legend={props.label}
        value={chosen}
        onValueChange={(value) => props.setValue(value)}
        disabled={props.disabled}
        error={check.error?.message}
      >
        {options.map((option) => (
          <KumoCheckbox.Item
            key={option.value}
            value={option.value}
            label={option.label}
            description={option.description}
          />
        ))}
      </KumoCheckbox.Group>
    );
  } else {
    control = (
      <KumoRadio
        {...aria}
        legend={props.label}
        disabled={props.disabled}
        error={check.error?.message}
        value={chosen[0] ?? ""}
        onValueChange={(value) => props.setValue([String(value)])}
      >
        {options.map((option) => (
          <KumoRadio.Item
            key={option.value}
            value={option.value}
            label={option.label}
            description={option.description}
          />
        ))}
      </KumoRadio>
    );
  }
  return (
    <div onBlur={check.onBlur} style={{ flexGrow: props.weight, minWidth: 0 }}>
      {control}
      {kind === "chips" || kind === "combobox" ? (
        <CheckMessage message={check.error?.message} />
      ) : null}
    </div>
  );
}

// ---- DateTimeInput ----

type DateTimeMode = "date" | "time" | "datetime";
interface DateTimeParts {
  date: string;
  time: string;
}

/** Copied from the standard DateTimeInput: date, time, or both. */
function dateTimeModeOf(props: StandardProps<"DateTimeInput">): DateTimeMode {
  const hasTime = props.enableTime === true;
  const hasDate = props.enableDate ?? !hasTime;
  return hasDate && hasTime ? "datetime" : hasTime ? "time" : "date";
}

/** Copied from the standard DateTimeInput: splits an ISO 8601 value. */
function splitDateTime(value: string): DateTimeParts {
  const [head, tail] = value.split("T");
  if (tail !== undefined) return { date: head, time: tail };
  if (/^\d{4}-/.test(value)) return { date: value, time: "" };
  if (/^\d{1,2}:\d{2}/.test(value)) return { date: "", time: value };
  return { date: "", time: "" };
}

/** Copied from the standard DateTimeInput: the value the model reads. */
function joinDateTime(parts: DateTimeParts, mode: DateTimeMode): string {
  if (mode === "date") return parts.date;
  if (mode === "time") return parts.time;
  return parts.date && parts.time ? `${parts.date}T${parts.time}` : "";
}

/** A local date as "YYYY-MM-DD". */
export function isoDateOf(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The local Date of "YYYY-MM-DD", or `undefined`. */
function dateOf(iso: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/**
 * DateTimeInput: a Kumo DatePicker in a Kumo Popover for the date, and a
 * Kumo time Input for the time (Kumo has no time picker). It writes the
 * same ISO 8601 values as the standard DateTimeInput.
 */
export function DateTimeInput(props: StandardProps<"DateTimeInput">) {
  const aria = useGenerativeUIAccessibility();
  const labelId = useId();
  const mode = dateTimeModeOf(props);
  const value = props.value ?? "";
  const check = useChecks(props.checks, props.value);
  const [parts, setParts] = useState(() => splitDateTime(value));
  const [isOpen, setIsOpen] = useState(false);
  const CalendarIcon = usePhosphorIcon("calendar");
  // The last value this control wrote. Another value comes from the data
  // model and replaces the parts, as in the standard DateTimeInput.
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
    props.setValue(nextValue);
  };
  const min = splitDateTime(props.min ?? "");
  const max = splitDateTime(props.max ?? "");
  const selected = dateOf(parts.date);
  const disabledDays = [
    ...(dateOf(min.date) ? [{ before: dateOf(min.date) as Date }] : []),
    ...(dateOf(max.date) ? [{ after: dateOf(max.date) as Date }] : []),
  ];

  const timeInput = (
    <Input
      type="time"
      label={mode === "time" ? props.label : undefined}
      aria-label={mode === "time" ? undefined : `${props.label ?? "Time"} time`}
      disabled={props.disabled}
      required={props.required}
      step={props.timeStep ? props.timeStep * 60 : undefined}
      min={
        mode === "time" || parts.date === min.date
          ? min.time || undefined
          : undefined
      }
      max={
        mode === "time" || parts.date === max.date
          ? max.time || undefined
          : undefined
      }
      value={parts.time}
      onChange={(event) => write({ ...parts, time: event.target.value })}
    />
  );
  if (mode === "time") {
    return (
      <div {...aria} onBlur={check.onBlur} style={{ flexGrow: props.weight }}>
        {timeInput}
        <CheckMessage message={check.error?.message} />
      </div>
    );
  }
  return (
    <div
      {...aria}
      role="group"
      aria-labelledby={props.label ? labelId : undefined}
      onBlur={check.onBlur}
      style={defined({
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        flexGrow: props.weight,
        width: props.block ? "100%" : undefined,
      })}
    >
      {props.label ? (
        <KumoLabel>{<span id={labelId}>{props.label}</span>}</KumoLabel>
      ) : null}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "8px",
          alignItems: "center",
        }}
      >
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <Popover.Trigger
            disabled={props.disabled}
            aria-label={`${props.label ?? "Date"} date`}
            render={
              <KumoButton
                variant="outline"
                icon={
                  CalendarIcon ? (
                    <CalendarIcon size={16} aria-hidden />
                  ) : undefined
                }
              />
            }
          >
            {selected
              ? selected.toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })
              : (props.placeholder ?? "Pick a date")}
          </Popover.Trigger>
          <Popover.Content>
            <div style={{ padding: "12px" }}>
              <DatePicker
                mode="single"
                selected={selected}
                defaultMonth={selected}
                disabled={disabledDays}
                onChange={(date: Date | undefined) => {
                  if (!date) return;
                  write({ ...parts, date: isoDateOf(date) });
                  setIsOpen(false);
                }}
              />
            </div>
          </Popover.Content>
        </Popover>
        {mode === "datetime" ? timeInput : null}
        {props.clearable && (parts.date || parts.time) ? (
          <KumoButton
            variant="ghost"
            size="sm"
            onClick={() => write({ date: "", time: "" })}
          >
            Clear
          </KumoButton>
        ) : null}
      </div>
      <CheckMessage message={check.error?.message} />
    </div>
  );
}

export const choiceOverrides = {
  Radio: { component: Radio },
  RadioGroup: { component: RadioGroup },
  Slider: { component: Slider },
  SegmentedControl: { component: SegmentedControl },
  ChoicePicker: { component: ChoicePicker },
  DateTimeInput: { component: DateTimeInput },
};
