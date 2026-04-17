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
      fields: [
        { kind: "string", name: "id", label: "id", required: true },
      ],
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
    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "bye" } });
    expect(onChange).toHaveBeenCalledWith({
      text: "bye",
      user: { id: "u1" },
      tags: ["work"],
    });
  });
});
