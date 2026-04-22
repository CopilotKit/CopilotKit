import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StringField } from "../StringField";
import { NumberField } from "../NumberField";
import { BooleanField } from "../BooleanField";

describe("StringField", () => {
  it("renders a text input and fires onChange", () => {
    const onChange = vi.fn();
    render(
      <StringField
        field={{ kind: "string", name: "t", label: "Text", required: true }}
        value="hi"
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText("Text") as HTMLInputElement;
    expect(input.value).toBe("hi");
    fireEvent.change(input, { target: { value: "bye" } });
    expect(onChange).toHaveBeenCalledWith("bye");
  });

  it("renders a select when enum is provided", () => {
    const onChange = vi.fn();
    render(
      <StringField
        field={{
          kind: "string",
          name: "c",
          label: "Color",
          required: true,
          enum: ["red", "blue"],
        }}
        value="red"
        onChange={onChange}
      />,
    );
    const select = screen.getByLabelText("Color") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    fireEvent.change(select, { target: { value: "blue" } });
    expect(onChange).toHaveBeenCalledWith("blue");
  });
});

describe("NumberField", () => {
  it("parses numeric input", () => {
    const onChange = vi.fn();
    render(
      <NumberField
        field={{ kind: "number", name: "n", label: "N", required: true }}
        value={3}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("N"), { target: { value: "42" } });
    expect(onChange).toHaveBeenCalledWith(42);
  });

  it("emits undefined for empty input (does not coerce to 0)", () => {
    const onChange = vi.fn();
    render(
      <NumberField
        field={{ kind: "number", name: "n", label: "N", required: false }}
        value={3}
        onChange={onChange}
      />,
    );
    // Optional fields render "N (optional)" — match by leading label text.
    fireEvent.change(screen.getByLabelText(/^N/), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});

describe("BooleanField", () => {
  it("toggles via checkbox", () => {
    const onChange = vi.fn();
    render(
      <BooleanField
        field={{ kind: "boolean", name: "b", label: "B", required: true }}
        value={false}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText("B"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("toggles from checked to unchecked", () => {
    const onChange = vi.fn();
    render(
      <BooleanField
        field={{ kind: "boolean", name: "b", label: "B", required: true }}
        value={true}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText("B"));
    expect(onChange).toHaveBeenCalledWith(false);
  });
});
