import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  ChoicePicker,
  DateTimeInput,
  Radio,
  RadioGroup,
  SegmentedControl,
  Slider,
  choiceKindOf,
  isoDateOf,
  radioAppearanceOf,
  sliderStepOf,
} from "../choices";

describe("radioAppearanceOf", () => {
  test.each([
    [undefined, "default"],
    ["list", "default"],
    ["cards", "card"],
    ["pills", "segmented"],
  ] as const)("%s → %s", (variant, appearance) => {
    expect(radioAppearanceOf(variant)).toBe(appearance);
  });
});

describe("choiceKindOf", () => {
  test.each([
    [{ filterable: true, displayStyle: "chips" }, "combobox"],
    [{ displayStyle: "chips" }, "chips"],
    [{ variant: "multipleSelection" }, "checkboxes"],
    [{ variant: "mutuallyExclusive" }, "radios"],
    [{}, "radios"],
  ] as const)("%o → %s", (props, kind) => {
    expect(choiceKindOf(props)).toBe(kind);
  });
});

describe("sliderStepOf", () => {
  test("steps divide the range", () => {
    expect(sliderStepOf({ min: 0, max: 100, steps: 4 })).toBe(25);
  });
  test("a step is used as given", () => {
    expect(sliderStepOf({ step: 5 })).toBe(5);
  });
  test("the default step is 1", () => {
    expect(sliderStepOf({})).toBe(1);
  });
});

describe("isoDateOf", () => {
  test("formats a local date as YYYY-MM-DD", () => {
    expect(isoDateOf(new Date(2026, 10, 7))).toBe("2026-11-07");
  });
});

describe("Radio", () => {
  test("renders its label", () => {
    render(<Radio value="a" label="Alone" />);
    expect(screen.getByText("Alone")).toBeTruthy();
  });
});

describe("RadioGroup", () => {
  test("a click calls setValue with the option value", () => {
    const setValue = vi.fn();
    render(
      <RadioGroup
        label="Days"
        options={["2", { value: "3", label: "Three" }]}
        setValue={setValue}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Three" }));
    expect(setValue).toHaveBeenCalledWith("3");
  });

  test("renders with no options", () => {
    render(<RadioGroup label="Days" setValue={() => {}} />);
    expect(screen.getByText("Days")).toBeTruthy();
  });
});

describe("SegmentedControl", () => {
  test("a click calls setValue", () => {
    const setValue = vi.fn();
    render(
      <SegmentedControl
        label="Period"
        options={["Month", "Year"]}
        value="Month"
        setValue={setValue}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Year" }));
    expect(setValue).toHaveBeenCalledWith("Year");
  });
});

describe("Slider", () => {
  test("shows the value with its unit", () => {
    render(
      <Slider
        label="Guests"
        value={3}
        min={1}
        max={8}
        unit="guests"
        setValue={() => {}}
      />,
    );
    expect(screen.getByText("3 guests")).toBeTruthy();
  });

  test("labels the marks inside the range, not the min and max again", () => {
    const { container } = render(
      <Slider
        label="Seats"
        value={5}
        min={1}
        max={50}
        marks={[{ value: 1 }, { value: 25, label: "25 seats" }, { value: 50 }]}
        setValue={() => {}}
      />,
    );
    expect(screen.getByText("25 seats")).toBeTruthy();
    // Kumo prints the min and max once; a mark must not repeat them.
    expect(container.textContent?.match(/50/g)).toHaveLength(1);
  });

  test("reflects a new bound value on rerender", () => {
    const { rerender } = render(
      <Slider label="Seats" value={5} min={1} max={50} setValue={() => {}} />,
    );
    rerender(
      <Slider label="Seats" value={30} min={1} max={50} setValue={() => {}} />,
    );
    // jsdom does not measure the thumb, so Base UI keeps it hidden.
    expect(
      screen
        .getByRole("slider", { hidden: true })
        .getAttribute("aria-valuenow"),
    ).toBe("30");
  });
});

describe("ChoicePicker", () => {
  test("mutually exclusive sets a one-item list", () => {
    const setValue = vi.fn();
    render(
      <ChoicePicker
        label="Plan"
        options={["a", "b"]}
        value={[]}
        setValue={setValue}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "b" }));
    expect(setValue).toHaveBeenCalledWith(["b"]);
  });

  test("chips toggle aria-pressed and add to the list", () => {
    const setValue = vi.fn();
    render(
      <ChoicePicker
        label="Tags"
        variant="multipleSelection"
        displayStyle="chips"
        options={["a", "b"]}
        value={["a"]}
        setValue={setValue}
      />,
    );
    expect(
      screen.getByRole("button", { name: "a" }).getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "b" }));
    expect(setValue).toHaveBeenCalledWith(["a", "b"]);
  });

  test("multiple selection checkboxes add to the list", () => {
    const setValue = vi.fn();
    render(
      <ChoicePicker
        label="Extras"
        variant="multipleSelection"
        options={["a", "b"]}
        value={["a"]}
        setValue={setValue}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "b" }));
    expect(setValue).toHaveBeenCalledWith(["a", "b"]);
  });
});

describe("DateTimeInput", () => {
  test("a time field writes HH:MM", () => {
    const setValue = vi.fn();
    render(<DateTimeInput label="Time" enableTime setValue={setValue} />);
    fireEvent.change(screen.getByLabelText("Time"), {
      target: { value: "09:30" },
    });
    expect(setValue).toHaveBeenCalledWith("09:30");
  });

  test("a date and time write YYYY-MM-DDTHH:MM", () => {
    const setValue = vi.fn();
    render(
      <DateTimeInput
        label="When"
        enableDate
        enableTime
        value="2026-11-07"
        setValue={setValue}
      />,
    );
    fireEvent.change(screen.getByLabelText("When time"), {
      target: { value: "19:00" },
    });
    expect(setValue).toHaveBeenCalledWith("2026-11-07T19:00");
  });

  test("shows a bound date", () => {
    render(
      <DateTimeInput label="Date" value="2026-11-07" setValue={() => {}} />,
    );
    expect(screen.getByText(/Nov 7, 2026|11\/7\/2026|2026-11-07/)).toBeTruthy();
  });
});
