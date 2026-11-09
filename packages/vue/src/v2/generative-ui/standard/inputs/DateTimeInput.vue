<script setup lang="ts">
import { computed, ref, useId, useTemplateRef, watch, watchEffect } from "vue";
import { px, spacing, textColor } from "@copilotkit/shared/generative-ui";
import type {
  FailedCheck,
  StyleMap,
  dateTimeInputSchema,
} from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import { controlAria, useGenerativeUIAccessibility } from "../../accessibility";
import { useStandardStyles } from "../../standard-styles";
import Field from "./Field.vue";
import { useChecks } from "./checks";
import {
  SELECT_STYLE,
  SMALL_SECONDARY_STYLE,
  asText,
  controlStyle,
} from "./control";
import {
  dateTimeMode,
  describeDateTime,
  joinDateTime,
  splitDateTime,
  timeInRange,
  timeSlots,
} from "./date-time";
import type { DateTimeParts } from "./date-time";

defineOptions({ name: "CopilotGenerativeUIDateTimeInput" });

type DateTimeInputProps = z.output<typeof dateTimeInputSchema>;

/**
 * A date, a time, or both. A date and a time are two fields under one
 * label, so each stays short and readable in every browser; the value is
 * written once both are set. Under the fields, the value in words makes the
 * date and the time (AM/PM included) unambiguous. `timeStep` shows the time
 * as a list of times instead of a typed field.
 *
 * `value` is writable through `update:value`. It is a prop and an emit, not
 * `defineModel`, because every write is emitted, also one that leaves the
 * value as it is: that write makes a bound value the user's, so a later
 * agent write does not replace a half-filled date and time.
 *
 * `enableDate` defaults to `undefined`, not `false`: unset, the user picks a
 * date unless only `enableTime` is set.
 */
const props = withDefaults(
  defineProps<{
    checks?: DateTimeInputProps["checks"];
    /** ISO 8601: "YYYY-MM-DD", "HH:MM" or "YYYY-MM-DDTHH:MM". */
    value?: DateTimeInputProps["value"];
    /** The visible label of the field. */
    label?: DateTimeInputProps["label"];
    /** The user picks a date. Default true unless only enableTime is set. */
    enableDate?: DateTimeInputProps["enableDate"];
    /** The user picks a time. */
    enableTime?: DateTimeInputProps["enableTime"];
    /** Minutes between the times in the list of times. */
    timeStep?: DateTimeInputProps["timeStep"];
    weight?: DateTimeInputProps["weight"];
    /** The earliest value, ISO 8601. */
    min?: DateTimeInputProps["min"];
    /** The latest value, ISO 8601. */
    max?: DateTimeInputProps["max"];
    placeholder?: DateTimeInputProps["placeholder"];
    disabled?: DateTimeInputProps["disabled"];
    required?: DateTimeInputProps["required"];
    /** Shows a button that clears the value. */
    clearable?: DateTimeInputProps["clearable"];
    /** Full width. */
    block?: DateTimeInputProps["block"];
  }>(),
  { enableDate: undefined, enableTime: undefined },
);

const emit = defineEmits<{
  /** Every write of the user, also one that leaves the value as it is. */
  "update:value": [value: string];
}>();

useStandardStyles();
const aria = useGenerativeUIAccessibility();
const id = useId();
const labelId = useId();
const summaryId = useId();
const dateField = useTemplateRef<HTMLInputElement>("dateField");
const timeInput = useTemplateRef<HTMLInputElement>("timeInput");
const slotList = useTemplateRef<HTMLSelectElement>("slotList");

const mode = computed(() => dateTimeMode(props));
const isSplit = computed(() => mode.value === "datetime");
const valueText = computed(() => asText(props.value));
const {
  error: checkError,
  invalid: checkInvalid,
  onBlur: touch,
} = useChecks(
  () => props.checks,
  () => props.value,
);
const parts = ref<DateTimeParts>(splitDateTime(valueText.value));
// The last value this control wrote. A different value comes from the data
// model (the agent, a binding) and replaces the parts; the control's own
// write keeps a half-filled date and time as they are.
let written: string | undefined;
watch(valueText, (value) => {
  if (value === written) return;
  written = undefined;
  parts.value = splitDateTime(value);
});

function write(next: DateTimeParts) {
  parts.value = next;
  const nextValue = joinDateTime(next, mode.value);
  written = nextValue;
  // Written even when unchanged: the write makes the value the user's, so a
  // later agent write does not replace a half-filled date and time.
  emit("update:value", nextValue);
}

const minParts = computed(() => splitDateTime(asText(props.min)));
const maxParts = computed(() => splitDateTime(asText(props.max)));
// A bound on the time applies on its own day only, when there is a date.
const timeMin = computed(() => {
  const min = minParts.value;
  const applies =
    mode.value === "time" || (min.time && parts.value.date === min.date);
  return applies ? min.time || undefined : undefined;
});
const timeMax = computed(() => {
  const max = maxParts.value;
  const applies =
    mode.value === "time" || (max.time && parts.value.date === max.date);
  return applies ? max.time || undefined : undefined;
});

// A list does not enforce min and max like a time field does: a time left
// out of range (the date moved to the day of a bound) is invalid.
const slotOutOfRange = computed(
  () =>
    props.timeStep !== undefined &&
    parts.value.time !== "" &&
    !timeInRange(parts.value.time, timeMin.value, timeMax.value),
);
const rangeError = computed((): FailedCheck | undefined => {
  if (!slotOutOfRange.value) return undefined;
  const from =
    (timeMin.value &&
      describeDateTime({ date: "", time: timeMin.value }, "time")) ||
    "the start of the day";
  const to =
    (timeMax.value &&
      describeDateTime({ date: "", time: timeMax.value }, "time")) ||
    "the end of the day";
  return {
    message: `Pick a time from ${from} to ${to}`,
    severity: "error",
    code: "TIME_OUT_OF_RANGE",
  };
});

// Half a date and time is no value: the empty field is invalid, so a form
// does not drop what the user entered. Both empty stays valid. `post`: the
// fields are in the DOM; a `post` effect does not run on the server.
watchEffect(
  () => {
    const { date, time } = parts.value;
    const isHalfFilled = isSplit.value && (date === "") !== (time === "");
    const dateMessage = isHalfFilled && date === "" ? "Pick a date too" : "";
    const timeMessage =
      rangeError.value?.message ??
      (isHalfFilled && time === "" ? "Pick a time too" : "");
    dateField.value?.setCustomValidity(dateMessage);
    slotList.value?.setCustomValidity(timeMessage);
    timeInput.value?.setCustomValidity(timeMessage);
  },
  { flush: "post" },
);

const slots = computed(() =>
  props.timeStep === undefined
    ? []
    : timeSlots(props.timeStep, timeMin.value, timeMax.value, parts.value.time),
);
const summary = computed(() => describeDateTime(parts.value, mode.value));
const showClear = computed(
  () =>
    Boolean(props.clearable) &&
    (parts.value.date !== "" || parts.value.time !== ""),
);
// One field names itself after the label; two fields are named "Date" and
// "Time" inside a group the label names.
const singleLabel = computed(
  () =>
    controlAria(aria.value)["aria-label"] ??
    (props.label ? undefined : props.placeholder),
);
/** The attributes that only a single field takes: its id and description. */
const single = computed(() =>
  isSplit.value
    ? {}
    : { id, "aria-description": controlAria(aria.value)["aria-description"] },
);
const groupAria = computed(() =>
  isSplit.value ? controlAria(aria.value) : {},
);
const fieldStyle = computed(() =>
  controlStyle({ disabled: props.disabled, pill: false }, "xl"),
);
const dateStyle = computed<StyleMap>(() => ({
  ...fieldStyle.value,
  flex: "1 1 10em",
  width: "auto",
}));
const timeStyle = computed<StyleMap>(() => ({
  ...fieldStyle.value,
  flex: "1 1 8em",
  width: "auto",
}));
const slotStyle = computed<StyleMap>(() => ({
  ...fieldStyle.value,
  ...SELECT_STYLE,
  flex: "1 1 8em",
  width: "auto",
}));
const rowStyle = computed<StyleMap>(() => ({
  display: props.block ? "flex" : "inline-flex",
  flexWrap: "wrap",
  width: props.block ? "100%" : undefined,
  maxWidth: "100%",
  gap: spacing(2),
  alignItems: "center",
}));
const CLEAR_STYLE: StyleMap = {
  minWidth: px(24),
  minHeight: px(24),
  border: "none",
  background: "transparent",
  cursor: "pointer",
  color: textColor("secondary"),
};

function slotLabel(slot: string) {
  return describeDateTime({ date: "", time: slot }, "time") ?? slot;
}

function onDate(event: Event) {
  if (!(event.target instanceof HTMLInputElement)) return;
  write({ ...parts.value, date: event.target.value });
}

function onTime(event: Event) {
  const target = event.target;
  const isField =
    target instanceof HTMLInputElement || target instanceof HTMLSelectElement;
  if (!isField) return;
  write({ ...parts.value, time: target.value });
}
</script>

<template>
  <Field
    :label="label"
    :html-for="isSplit ? undefined : id"
    :label-id="isSplit ? labelId : undefined"
    :weight="weight"
    :error="checkError ?? rangeError"
    @touch="touch"
  >
    <div
      :role="isSplit ? 'group' : undefined"
      :aria-labelledby="isSplit && label ? labelId : undefined"
      v-bind="groupAria"
      :style="rowStyle"
    >
      <input
        v-if="mode !== 'time'"
        ref="dateField"
        v-bind="single"
        type="date"
        data-a2ui-input=""
        :disabled="disabled"
        :required="required"
        :aria-invalid="checkInvalid || undefined"
        :aria-describedby="summary ? summaryId : undefined"
        :aria-label="isSplit ? 'Date' : singleLabel"
        :min="minParts.date || undefined"
        :max="maxParts.date || undefined"
        :placeholder="placeholder"
        :value="parts.date"
        :style="dateStyle"
        @input="onDate"
      />
      <template v-if="mode !== 'date'">
        <select
          v-if="timeStep !== undefined"
          ref="slotList"
          v-bind="single"
          data-a2ui-input=""
          :disabled="disabled"
          :required="required"
          :aria-invalid="checkInvalid || slotOutOfRange || undefined"
          :aria-describedby="summary ? summaryId : undefined"
          :aria-label="isSplit ? 'Time' : singleLabel"
          :value="parts.time.slice(0, 5)"
          :style="slotStyle"
          @change="onTime"
        >
          <option value="" :selected="parts.time === ''">
            {{ placeholder ?? "Time" }}
          </option>
          <option
            v-for="slot in slots"
            :key="slot"
            :value="slot"
            :selected="slot === parts.time.slice(0, 5)"
          >
            {{ slotLabel(slot) }}
          </option>
        </select>
        <input
          v-else
          ref="timeInput"
          v-bind="single"
          type="time"
          data-a2ui-input=""
          :disabled="disabled"
          :required="required"
          :aria-invalid="checkInvalid || undefined"
          :aria-describedby="summary ? summaryId : undefined"
          :aria-label="isSplit ? 'Time' : singleLabel"
          :min="timeMin"
          :max="timeMax"
          :placeholder="placeholder"
          :value="parts.time"
          :style="timeStyle"
          @input="onTime"
        />
      </template>
      <button
        v-if="showClear"
        type="button"
        data-a2ui-input=""
        aria-label="Clear"
        :style="CLEAR_STYLE"
        @click="write({ date: '', time: '' })"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
    <span
      v-if="summary"
      :id="summaryId"
      data-a2ui-datetime-summary=""
      :style="SMALL_SECONDARY_STYLE"
      >{{ summary }}</span
    >
  </Field>
</template>
