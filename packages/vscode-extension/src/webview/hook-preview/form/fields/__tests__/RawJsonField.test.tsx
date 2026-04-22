import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RawJsonField } from "../RawJsonField";

describe("RawJsonField", () => {
  const field = {
    kind: "raw-json" as const,
    name: "args",
    label: "args",
    required: true,
    hint: "Edit as JSON.",
  };

  it("parses valid JSON on blur", () => {
    const onChange = vi.fn();
    render(<RawJsonField field={field} value={{ a: 1 }} onChange={onChange} />);
    const ta = screen.getByLabelText("args") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '{"a":2}' } });
    fireEvent.blur(ta);
    expect(onChange).toHaveBeenCalledWith({ a: 2 });
  });

  it("shows a parse error and does not fire onChange for invalid JSON", () => {
    const onChange = vi.fn();
    render(<RawJsonField field={field} value={{}} onChange={onChange} />);
    const ta = screen.getByLabelText("args") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "{invalid" } });
    fireEvent.blur(ta);
    expect(screen.getByRole("alert").textContent).toMatch(/Invalid JSON/i);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("skips onChange when the textarea is cleared (no {} clobber)", () => {
    const onChange = vi.fn();
    render(<RawJsonField field={field} value={{ a: 1 }} onChange={onChange} />);
    const ta = screen.getByLabelText("args") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "" } });
    fireEvent.blur(ta);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("clears an existing error once the input becomes valid JSON again", () => {
    const onChange = vi.fn();
    render(<RawJsonField field={field} value={{}} onChange={onChange} />);
    const ta = screen.getByLabelText("args") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "{bad" } });
    fireEvent.blur(ta);
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.change(ta, { target: { value: '{"ok":true}' } });
    fireEvent.blur(ta);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onChange).toHaveBeenCalledWith({ ok: true });
  });
});
