import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ActionControls } from "../ActionControls";
import type { FormSchema } from "../../form/schema/types";

const schema: FormSchema = {
  fields: [{ kind: "string", name: "text", label: "text", required: true }],
};

describe("ActionControls", () => {
  it("renders status dropdown, form, and result editor", () => {
    const onChange = vi.fn();
    render(
      <ActionControls
        schema={schema}
        values={{
          args: { text: "hi" },
          status: "complete",
          result: "ok",
          onRespond: () => {},
        }}
        onChange={onChange}
      />,
    );
    expect((screen.getByLabelText("Status") as HTMLSelectElement).value).toBe(
      "complete",
    );
    expect((screen.getByLabelText("text") as HTMLInputElement).value).toBe(
      "hi",
    );
    expect((screen.getByLabelText("Result") as HTMLInputElement).value).toBe(
      "ok",
    );
  });

  it("disables result field when status is not complete", () => {
    const onChange = vi.fn();
    render(
      <ActionControls
        schema={schema}
        values={{
          args: {},
          status: "executing",
          result: "",
          onRespond: () => {},
        }}
        onChange={onChange}
      />,
    );
    expect((screen.getByLabelText("Result") as HTMLInputElement).disabled).toBe(
      true,
    );
  });

  it("propagates status changes", () => {
    const onChange = vi.fn();
    render(
      <ActionControls
        schema={schema}
        values={{
          args: {},
          status: "inProgress",
          result: "",
          onRespond: () => {},
        }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "complete" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ status: "complete" }),
    );
  });
});
