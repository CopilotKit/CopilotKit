import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ArrayField } from "../ArrayField";

describe("ArrayField", () => {
  const field = {
    kind: "array" as const,
    name: "tags",
    label: "Tags",
    required: true,
    items: {
      kind: "string" as const,
      name: "item",
      label: "item",
      required: true,
    },
  };

  it("renders existing items and supports remove", () => {
    const onChange = vi.fn();
    render(<ArrayField field={field} value={["a", "b"]} onChange={onChange} />);
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]);
    expect(onChange).toHaveBeenCalledWith(["b"]);
  });

  it("adds a new default item when Add is clicked", () => {
    const onChange = vi.fn();
    render(<ArrayField field={field} value={["a"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onChange).toHaveBeenCalledWith(["a", ""]);
  });

  it("updates item value via item onChange", () => {
    const onChange = vi.fn();
    render(<ArrayField field={field} value={["x"]} onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "y" } });
    expect(onChange).toHaveBeenCalledWith(["y"]);
  });
});
