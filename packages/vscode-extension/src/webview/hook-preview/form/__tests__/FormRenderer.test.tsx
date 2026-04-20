import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FormRenderer } from "../FormRenderer";
import type { FormSchema } from "../schema/types";

const schema: FormSchema = {
  fields: [
    { kind: "string", name: "text", label: "Text", required: true },
    {
      kind: "object",
      name: "user",
      label: "User",
      required: true,
      fields: [{ kind: "string", name: "id", label: "id", required: true }],
    },
    {
      kind: "array",
      name: "tags",
      label: "Tags",
      required: true,
      items: { kind: "string", name: "item", label: "item", required: true },
    },
  ],
};

describe("FormRenderer", () => {
  it("renders all fields and propagates a top-level change", () => {
    const onChange = vi.fn();
    render(
      <FormRenderer
        schema={schema}
        values={{ text: "hi", user: { id: "u1" }, tags: ["work"] }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Text"), {
      target: { value: "bye" },
    });
    expect(onChange).toHaveBeenCalledWith({
      text: "bye",
      user: { id: "u1" },
      tags: ["work"],
    });
  });

  it("propagates a nested object field change through the composition", () => {
    const onChange = vi.fn();
    render(
      <FormRenderer
        schema={schema}
        values={{ text: "hi", user: { id: "u1" }, tags: ["work"] }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("id"), { target: { value: "u2" } });
    expect(onChange).toHaveBeenCalledWith({
      text: "hi",
      user: { id: "u2" },
      tags: ["work"],
    });
  });

  it("propagates an array add through the composition", () => {
    const onChange = vi.fn();
    render(
      <FormRenderer
        schema={schema}
        values={{ text: "hi", user: { id: "u1" }, tags: ["work"] }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onChange).toHaveBeenCalledWith({
      text: "hi",
      user: { id: "u1" },
      tags: ["work", ""],
    });
  });

  it("drops a key when a field emits undefined (optional cleared)", () => {
    const optionalSchema: FormSchema = {
      fields: [
        { kind: "number", name: "count", label: "count", required: false },
      ],
    };
    const onChange = vi.fn();
    render(
      <FormRenderer
        schema={optionalSchema}
        values={{ count: 3 }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText(/^count/), {
      target: { value: "" },
    });
    expect(onChange).toHaveBeenCalledWith({});
  });
});
