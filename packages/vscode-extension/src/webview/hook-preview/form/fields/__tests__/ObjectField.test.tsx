import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ObjectField } from "../ObjectField";

describe("ObjectField", () => {
  const field = {
    kind: "object" as const,
    name: "user",
    label: "User",
    required: true,
    fields: [
      { kind: "string" as const, name: "id", label: "id", required: true },
      {
        kind: "boolean" as const,
        name: "active",
        label: "active",
        required: true,
      },
    ],
  };

  it("renders nested fields and propagates changes", () => {
    const onChange = vi.fn();
    render(
      <ObjectField
        field={field}
        value={{ id: "x", active: true }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("id"), { target: { value: "y" } });
    expect(onChange).toHaveBeenCalledWith({ id: "y", active: true });
  });
});
