import { describe, expect, it } from "vitest";
import { updateDataModel } from "../../../__tests__/render";
import {
  describeDateTime,
  splitDateTime,
  timeInRange,
  timeSlots,
} from "../index";
import {
  byAriaLabel,
  byLabel,
  click,
  query,
  renderInputs,
  setValue,
} from "./helpers";

describe("standard inputs: DateTimeInput", () => {
  const inWords = (
    date: string,
    time: string,
    mode: "date" | "time" | "datetime",
  ) => describeDateTime({ date, time }, mode);

  it("splits an ISO value into its date and its time", () => {
    expect(splitDateTime("2026-10-23T14:30")).toEqual({
      date: "2026-10-23",
      time: "14:30",
    });
    expect(splitDateTime("2026-10-23")).toEqual({
      date: "2026-10-23",
      time: "",
    });
    expect(splitDateTime("09:15")).toEqual({ date: "", time: "09:15" });
    expect(splitDateTime("")).toEqual({ date: "", time: "" });
  });

  it("says the value in words with the hour of the day, and nothing for an incomplete value", () => {
    const text = describeDateTime(
      { date: "2026-10-23", time: "14:30" },
      "datetime",
      "en-US",
    );
    expect(text).toContain("Oct 23, 2026");
    expect(text).toContain("2:30");
    expect(text).toContain("PM");
    expect(describeDateTime({ date: "", time: "09:05" }, "time", "en-US")).toBe(
      "9:05 AM",
    );
    expect(
      describeDateTime({ date: "2026-10-23", time: "" }, "datetime"),
    ).toBeUndefined();
    expect(
      describeDateTime({ date: "soon", time: "" }, "date"),
    ).toBeUndefined();
  });

  it("lists the times of a day step minutes apart within the bounds, keeping a current off-step time", () => {
    expect(timeSlots(360)).toEqual(["00:00", "06:00", "12:00", "18:00"]);
    expect(timeSlots(30, "09:00", "10:30")).toEqual([
      "09:00",
      "09:30",
      "10:00",
      "10:30",
    ]);
    expect(timeSlots(60, "09:00", "11:00", "09:45")).toEqual([
      "09:00",
      "09:45",
      "10:00",
      "11:00",
    ]);
  });

  it("shows a date and a time as two named fields under one label and writes the value once both are set", () => {
    const view = renderInputs(
      [
        {
          id: "root",
          component: "DateTimeInput",
          label: "Pickup",
          enableDate: true,
          enableTime: true,
          value: { "@path": "/when" },
        },
      ],
      { when: "" },
    );
    const group = query(view, "[role=group]");
    expect(
      view.container.querySelector(`#${group.getAttribute("aria-labelledby")}`)
        ?.textContent,
    ).toBe("Pickup");
    const date = byAriaLabel<HTMLInputElement>(view, "Date");
    const time = byAriaLabel<HTMLInputElement>(view, "Time");
    expect(date.type).toBe("date");
    expect(time.type).toBe("time");
    setValue(view, date, "2026-10-23");
    // Half a value is not a value.
    expect(view.dataAt("/when")).toBe("");
    expect(date.value).toBe("2026-10-23");
    expect(time.validationMessage).toBe("Pick a time too");
    setValue(view, time, "14:30");
    expect(view.dataAt("/when")).toBe("2026-10-23T14:30");
    expect(
      query(view, "[data-a2ui-datetime-summary]").textContent?.trim(),
    ).toBe(inWords("2026-10-23", "14:30", "datetime"));
    // Clearing the time clears the value and keeps the date.
    setValue(view, time, "");
    expect(view.dataAt("/when")).toBe("");
    expect(date.value).toBe("2026-10-23");
  });

  it("shows a value the agent writes, and clears both fields with the clear button", () => {
    const view = renderInputs(
      [
        {
          id: "root",
          component: "DateTimeInput",
          label: "Pickup",
          enableDate: true,
          enableTime: true,
          clearable: true,
          value: { "@path": "/when" },
        },
      ],
      { when: "2026-10-23T09:00" },
    );
    const date = byAriaLabel<HTMLInputElement>(view, "Date");
    const time = byAriaLabel<HTMLInputElement>(view, "Time");
    expect([date.value, time.value]).toEqual(["2026-10-23", "09:00"]);
    view.update(updateDataModel("/when", "2026-11-02T17:15"));
    expect([date.value, time.value]).toEqual(["2026-11-02", "17:15"]);
    click(view, byAriaLabel(view, "Clear"));
    expect(view.dataAt("/when")).toBe("");
    expect([date.value, time.value]).toEqual(["", ""]);
  });

  it("applies a time bound only on the day of that bound", () => {
    const view = renderInputs(
      [
        {
          id: "root",
          component: "DateTimeInput",
          label: "Pickup",
          enableDate: true,
          enableTime: true,
          min: "2026-10-23T09:00",
          max: "2026-10-30T17:00",
          value: { "@path": "/when" },
        },
      ],
      { when: "2026-10-23T10:00" },
    );
    const date = byAriaLabel<HTMLInputElement>(view, "Date");
    const time = byAriaLabel<HTMLInputElement>(view, "Time");
    expect([date.min, date.max]).toEqual(["2026-10-23", "2026-10-30"]);
    expect([time.min, time.max]).toEqual(["09:00", ""]);
    setValue(view, date, "2026-10-30");
    expect([time.min, time.max]).toEqual(["", "17:00"]);
  });

  it("offers the times as a list with timeStep, named in words", () => {
    const view = renderInputs(
      [
        {
          id: "root",
          component: "DateTimeInput",
          label: "Call time",
          enableTime: true,
          timeStep: 30,
          min: "09:00",
          max: "10:00",
          value: { "@path": "/at" },
        },
      ],
      { at: "" },
    );
    const select = byLabel<HTMLSelectElement>(view, "Call time");
    expect(select.tagName).toBe("SELECT");
    expect([...select.options].map((o) => o.value)).toEqual([
      "",
      "09:00",
      "09:30",
      "10:00",
    ]);
    expect(select.options[2]!.textContent?.trim()).toBe(
      inWords("", "09:30", "time"),
    );
    setValue(view, select, "09:30");
    expect(view.dataAt("/at")).toBe("09:30");
  });

  it("formats the value as written, not shifted by a daylight-saving gap of the viewer", () => {
    const zone = process.env["TZ"];
    process.env["TZ"] = "Europe/Vienna";
    try {
      // 02:30 on 29 March 2026 does not exist in Vienna.
      const text = describeDateTime(
        { date: "2026-03-29", time: "02:30" },
        "datetime",
        "en-US",
      );
      expect(text).toContain("2:30");
      expect(text).not.toContain("3:30");
    } finally {
      process.env["TZ"] = zone;
    }
  });

  it("lists a range over midnight from its start", () => {
    expect(timeInRange("23:00", "22:00", "02:00")).toBe(true);
    expect(timeInRange("01:00", "22:00", "02:00")).toBe(true);
    expect(timeInRange("12:00", "22:00", "02:00")).toBe(false);
    expect(timeSlots(60, "22:00", "02:00")).toEqual([
      "22:00",
      "23:00",
      "00:00",
      "01:00",
      "02:00",
    ]);
  });

  it("marks a listed time that the date moved out of range as invalid, so a form does not submit it", () => {
    const view = renderInputs(
      [
        { id: "root", component: "Form", label: "Booking", children: ["when"] },
        {
          id: "when",
          component: "DateTimeInput",
          label: "Call",
          enableDate: true,
          enableTime: true,
          timeStep: 30,
          min: "2026-11-02T09:00",
          value: { "@path": "/when" },
        },
      ],
      { when: "2026-11-03T08:30" },
    );
    const form = query<HTMLFormElement>(view, "form");
    const time = byAriaLabel<HTMLSelectElement>(view, "Time");
    expect(time.tagName).toBe("SELECT");
    expect(time.options[1]!.textContent?.trim()).toBe(
      inWords("", "00:00", "time"),
    );
    // The day after the bound: 08:30 is fine.
    expect(form.checkValidity()).toBe(true);
    setValue(view, byAriaLabel<HTMLInputElement>(view, "Date"), "2026-11-02");
    expect(time.value).toBe("08:30");
    expect(time.getAttribute("aria-invalid")).toBe("true");
    expect(form.checkValidity()).toBe(false);
    expect(query(view, "[role=alert]").textContent?.trim()).toBe(
      `Pick a time from ${inWords("", "09:00", "time")} to the end of the day`,
    );
    setValue(view, time, "09:30");
    expect(view.dataAt("/when")).toBe("2026-11-02T09:30");
    expect(form.checkValidity()).toBe(true);
    expect(view.container.querySelector("[role=alert]")).toBeNull();
  });

  it("steps the slots from the range start, and compares bounds with their seconds", () => {
    expect(timeSlots(30, "09:15", "10:15")).toEqual([
      "09:15",
      "09:45",
      "10:15",
    ]);
    expect(timeSlots(30, "09:15", "09:20")).toEqual(["09:15"]);
    expect(timeSlots(90, "23:00", "02:00")).toEqual([
      "23:00",
      "00:30",
      "02:00",
    ]);
    expect(timeInRange("10:00:30", undefined, "10:00")).toBe(false);
    expect(timeInRange("10:00", undefined, "10:00:30")).toBe(true);
  });

  it("gives an impossible date no summary rather than a rolled-over one", () => {
    expect(
      describeDateTime({ date: "2026-02-30", time: "" }, "date"),
    ).toBeUndefined();
    expect(
      describeDateTime({ date: "", time: "25:00" }, "time"),
    ).toBeUndefined();
  });

  it("does not let a form submit half a date and time, and allows both empty", () => {
    const view = renderInputs(
      [
        { id: "root", component: "Form", label: "Booking", children: ["when"] },
        {
          id: "when",
          component: "DateTimeInput",
          label: "Pickup",
          enableDate: true,
          enableTime: true,
          value: { "@path": "/when" },
        },
      ],
      { when: "" },
    );
    const form = query<HTMLFormElement>(view, "form");
    expect(form.checkValidity()).toBe(true);
    const time = byAriaLabel<HTMLInputElement>(view, "Time");
    setValue(view, byAriaLabel<HTMLInputElement>(view, "Date"), "2026-10-23");
    expect(form.checkValidity()).toBe(false);
    expect(time.validationMessage).toBe("Pick a time too");
    setValue(view, time, "14:30");
    expect(form.checkValidity()).toBe(true);
  });

  // A write of an equal value still claims the path: `valueWrite`, not the model.
  it("keeps a half-filled date and time when the agent writes the value afterwards", () => {
    const view = renderInputs(
      [
        {
          id: "root",
          component: "DateTimeInput",
          label: "Pickup",
          enableDate: true,
          enableTime: true,
          value: { "@path": "/when" },
        },
      ],
      { when: "" },
    );
    const date = byAriaLabel<HTMLInputElement>(view, "Date");
    setValue(view, date, "2026-10-23");
    // The user owns the path now: a half-filled entry stays over an agent write.
    view.update(updateDataModel("/when", "2026-12-01T08:00"));
    expect(date.value).toBe("2026-10-23");
    expect(view.dataAt("/when")).toBe("");
  });

  it("keeps a single time field named by its label", () => {
    const view = renderInputs(
      [
        {
          id: "root",
          component: "DateTimeInput",
          label: "Alarm",
          enableTime: true,
          value: { "@path": "/alarm" },
        },
      ],
      { alarm: "07:45" },
    );
    const time = byLabel<HTMLInputElement>(view, "Alarm");
    expect(time.type).toBe("time");
    expect(time.value).toBe("07:45");
    expect(view.container.querySelector("[role=group]")).toBeNull();
    expect(
      query(view, "[data-a2ui-datetime-summary]").textContent?.trim(),
    ).toBe(inWords("", "07:45", "time"));
  });
});
