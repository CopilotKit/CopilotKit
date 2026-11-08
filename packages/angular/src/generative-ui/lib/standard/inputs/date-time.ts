import {
  Component,
  ElementRef,
  computed,
  effect,
  input,
  signal,
  untracked,
  viewChild,
} from "@angular/core";
import { spacing, textColor } from "@copilotkit/shared/generative-ui";
import type { FailedCheck } from "@copilotkit/shared/generative-ui";
import { px } from "../style";
import type { StyleMap } from "../style";
import {
  CopilotGenerativeUIControl,
  FIELD_HOST,
  SELECT_STYLE,
  asText,
  controlStyle,
  fieldStyle,
  uniqueId,
} from "./control";

type DateTimeMode = "date" | "time" | "datetime";

interface DateTimeParts {
  /** "YYYY-MM-DD", or "" */
  date: string;
  /** "HH:MM" (seconds kept when given), or "" */
  time: string;
}

/** The date and the time of an ISO 8601 value: a date, a time, or both. */
export function splitDateTime(value: string): DateTimeParts {
  const [head = "", tail] = value.split("T");
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
  return `${match[1]!.padStart(2, "0")}:${match[2]}:${match[3] ?? "00"}`;
}

/** The minute of the day of a time, rounded up to a whole minute. */
function timeToMinute(time: string) {
  const [hours = 0, minutes = 0, seconds = 0] = fullTime(time)
    .split(":")
    .map(Number);
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
@Component({
  selector: "div[copilotGenerativeUIDateTimeInput]",
  template: `
    @if (label(); as label) {
      @if (isSplit()) {
        <span [id]="labelId" [style]="labelStyle">{{ label }}</span>
      } @else {
        <label [attr.for]="id" [style]="labelStyle">{{ label }}</label>
      }
    }
    <div
      [attr.role]="isSplit() ? 'group' : null"
      [attr.aria-labelledby]="isSplit() && label() ? labelId : null"
      [attr.aria-label]="isSplit() ? (control()['aria-label'] ?? null) : null"
      [attr.aria-description]="
        isSplit() ? (control()['aria-description'] ?? null) : null
      "
      [style]="rowStyle()"
    >
      @if (mode() !== "time") {
        <input
          #dateField
          type="date"
          data-a2ui-input
          [attr.id]="isSplit() ? null : id"
          [attr.aria-label]="isSplit() ? 'Date' : singleLabel()"
          [attr.aria-description]="
            isSplit() ? null : (control()['aria-description'] ?? null)
          "
          [attr.aria-describedby]="summary() ? summaryId : null"
          [attr.aria-invalid]="state.invalid() ? 'true' : null"
          [disabled]="disabled() ?? false"
          [required]="required() ?? false"
          [attr.min]="minParts().date || null"
          [attr.max]="maxParts().date || null"
          [attr.placeholder]="placeholder() ?? null"
          [value]="parts().date"
          (input)="writeDate($event)"
          [style]="dateStyle()"
        />
      }
      @if (mode() !== "date") {
        @if (timeStep() !== undefined) {
          <select
            #slotList
            data-a2ui-input
            [attr.id]="isSplit() ? null : id"
            [attr.aria-label]="isSplit() ? 'Time' : singleLabel()"
            [attr.aria-description]="
              isSplit() ? null : (control()['aria-description'] ?? null)
            "
            [attr.aria-describedby]="summary() ? summaryId : null"
            [attr.aria-invalid]="
              state.invalid() || slotOutOfRange() ? 'true' : null
            "
            [disabled]="disabled() ?? false"
            [required]="required() ?? false"
            [value]="parts().time.slice(0, 5)"
            (change)="writeTime($event)"
            [style]="slotStyle()"
          >
            <option value="">{{ placeholder() ?? "Time" }}</option>
            @for (slot of slots(); track slot) {
              <option [value]="slot" [selected]="slot === parts().time.slice(0, 5)">
                {{ slotLabel(slot) }}
              </option>
            }
          </select>
        } @else {
          <input
            #timeInput
            type="time"
            data-a2ui-input
            [attr.id]="isSplit() ? null : id"
            [attr.aria-label]="isSplit() ? 'Time' : singleLabel()"
            [attr.aria-description]="
              isSplit() ? null : (control()['aria-description'] ?? null)
            "
            [attr.aria-describedby]="summary() ? summaryId : null"
            [attr.aria-invalid]="state.invalid() ? 'true' : null"
            [disabled]="disabled() ?? false"
            [required]="required() ?? false"
            [attr.min]="timeMin() ?? null"
            [attr.max]="timeMax() ?? null"
            [attr.placeholder]="placeholder() ?? null"
            [value]="parts().time"
            (input)="writeTime($event)"
            [style]="timeStyle()"
          />
        }
      }
      @if (showClear()) {
        <button
          type="button"
          data-a2ui-input
          aria-label="Clear"
          (click)="clear()"
          [style]="clearStyle"
        >
          <span aria-hidden="true">×</span>
        </button>
      }
    </div>
    @if (summary(); as summary) {
      <span [id]="summaryId" data-a2ui-datetime-summary [style]="smallStyle">{{
        summary
      }}</span>
    }
    @if (shownError(); as error) {
      <span
        [attr.role]="error.severity === 'error' ? 'alert' : 'status'"
        data-a2ui-check-error
        [attr.data-a2ui-check-severity]="error.severity"
        [attr.data-a2ui-check-code]="error.code ?? null"
        [style]="checkStyle(error.severity)"
        >{{ error.message }}</span
      >
    }
  `,
  host: FIELD_HOST,
})
export class CopilotGenerativeUIDateTimeInput extends CopilotGenerativeUIControl<string> {
  readonly label = input<string>();
  readonly enableDate = input<boolean>();
  readonly enableTime = input<boolean>();
  readonly timeStep = input<number>();
  readonly weight = input<number>();
  readonly min = input<string>();
  readonly max = input<string>();
  readonly placeholder = input<string>();
  readonly clearable = input<boolean>();
  readonly block = input<boolean>();

  protected readonly id = uniqueId("a2ui-datetime");
  protected readonly labelId = uniqueId("a2ui-datetime-label");
  protected readonly summaryId = uniqueId("a2ui-datetime-summary");
  protected readonly dateField =
    viewChild<ElementRef<HTMLInputElement>>("dateField");
  protected readonly timeInput =
    viewChild<ElementRef<HTMLInputElement>>("timeInput");
  protected readonly slotList =
    viewChild<ElementRef<HTMLSelectElement>>("slotList");

  /** What the user picks: a date by default, a time, or both. */
  protected readonly mode = computed<DateTimeMode>(() => {
    const hasTime = this.enableTime() === true;
    const hasDate = this.enableDate() ?? !hasTime;
    return hasDate && hasTime ? "datetime" : hasTime ? "time" : "date";
  });
  protected readonly isSplit = computed(() => this.mode() === "datetime");
  protected readonly parts = signal<DateTimeParts>({ date: "", time: "" });
  /**
   * The last value this control wrote. A different value comes from the
   * data model (the agent, a binding) and replaces the parts; the control's
   * own write keeps a half-filled date and time as they are.
   */
  #written: string | undefined;

  protected readonly minParts = computed(() =>
    splitDateTime(asText(this.min())),
  );
  protected readonly maxParts = computed(() =>
    splitDateTime(asText(this.max())),
  );
  // A bound on the time applies on its own day only, when there is a date.
  protected readonly timeMin = computed(() => {
    const min = this.minParts();
    return this.mode() === "time" ||
      (min.time && this.parts().date === min.date)
      ? min.time || undefined
      : undefined;
  });
  protected readonly timeMax = computed(() => {
    const max = this.maxParts();
    return this.mode() === "time" ||
      (max.time && this.parts().date === max.date)
      ? max.time || undefined
      : undefined;
  });
  // A list does not enforce min and max like a time field does: a time
  // left out of range (the date moved to the day of a bound) is invalid.
  protected readonly slotOutOfRange = computed(
    () =>
      this.timeStep() !== undefined &&
      this.parts().time !== "" &&
      !timeInRange(this.parts().time, this.timeMin(), this.timeMax()),
  );
  protected readonly rangeError = computed<FailedCheck | undefined>(() => {
    if (!this.slotOutOfRange()) return undefined;
    const timeMin = this.timeMin();
    const timeMax = this.timeMax();
    return {
      message: `Pick a time from ${
        (timeMin && describeDateTime({ date: "", time: timeMin }, "time")) ||
        "the start of the day"
      } to ${
        (timeMax && describeDateTime({ date: "", time: timeMax }, "time")) ||
        "the end of the day"
      }`,
      severity: "error",
      code: "TIME_OUT_OF_RANGE",
    };
  });
  protected readonly shownError = computed(
    () => this.state.error() ?? this.rangeError(),
  );
  protected readonly slots = computed(() =>
    timeSlots(
      this.timeStep() ?? 30,
      this.timeMin(),
      this.timeMax(),
      this.parts().time,
    ),
  );
  protected readonly summary = computed(() =>
    describeDateTime(this.parts(), this.mode()),
  );
  protected readonly showClear = computed(
    () =>
      Boolean(this.clearable()) &&
      (this.parts().date !== "" || this.parts().time !== ""),
  );
  // One field names itself after the label; two fields are named "Date"
  // and "Time" inside a group the label names.
  protected readonly singleLabel = computed(
    () =>
      this.control()["aria-label"] ??
      (this.label() ? null : (this.placeholder() ?? null)),
  );
  protected readonly hostStyle = computed(() => fieldStyle(this.weight()));
  readonly #controlStyle = computed(() =>
    controlStyle({ pill: false, disabled: this.disabled() }, "xl"),
  );
  protected readonly dateStyle = computed<StyleMap>(() => ({
    ...this.#controlStyle(),
    flex: "1 1 10em",
    width: "auto",
  }));
  protected readonly timeStyle = computed<StyleMap>(() => ({
    ...this.#controlStyle(),
    flex: "1 1 8em",
    width: "auto",
  }));
  protected readonly slotStyle = computed<StyleMap>(() => ({
    ...this.#controlStyle(),
    ...SELECT_STYLE,
    flex: "1 1 8em",
    width: "auto",
  }));
  protected readonly rowStyle = computed<StyleMap>(() => ({
    display: this.block() ? "flex" : "inline-flex",
    flexWrap: "wrap",
    width: this.block() ? "100%" : undefined,
    maxWidth: "100%",
    gap: spacing(2),
    alignItems: "center",
  }));
  protected readonly clearStyle: StyleMap = {
    minWidth: px(24),
    minHeight: px(24),
    border: "none",
    background: "transparent",
    cursor: "pointer",
    color: textColor("secondary"),
  };

  constructor() {
    super();
    // A value from the data model replaces the parts; the control's own
    // write does not.
    effect(() => {
      const value = asText(this.value());
      untracked(() => {
        if (value === this.#written) return;
        this.#written = undefined;
        this.parts.set(splitDateTime(value));
      });
    });
    // Half a date and time is no value: the empty field is invalid, so a
    // form does not drop what the user entered. Both empty stays valid.
    effect(() => {
      const parts = this.parts();
      const halfFilled =
        this.mode() === "datetime" &&
        (parts.date === "") !== (parts.time === "");
      const dateMessage =
        halfFilled && parts.date === "" ? "Pick a date too" : "";
      const timeMessage =
        this.rangeError()?.message ??
        (halfFilled && parts.time === "" ? "Pick a time too" : "");
      this.dateField()?.nativeElement.setCustomValidity(dateMessage);
      this.slotList()?.nativeElement.setCustomValidity(timeMessage);
      this.timeInput()?.nativeElement.setCustomValidity(timeMessage);
    });
  }

  protected slotLabel(slot: string) {
    return describeDateTime({ date: "", time: slot }, "time") ?? slot;
  }

  #write(next: DateTimeParts) {
    this.parts.set(next);
    const nextValue = joinDateTime(next, this.mode());
    this.#written = nextValue;
    // Written even when unchanged: the write makes the value the user's, so
    // a later agent write does not replace a half-filled date and time.
    this.setValue(nextValue);
  }

  protected writeDate(event: Event) {
    const date = (event.target as HTMLInputElement).value;
    this.#write({ ...this.parts(), date });
  }

  protected writeTime(event: Event) {
    const time = (event.target as HTMLInputElement | HTMLSelectElement).value;
    this.#write({ ...this.parts(), time });
  }

  protected clear() {
    this.#write({ date: "", time: "" });
  }
}
