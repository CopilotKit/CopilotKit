import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { FixturePicker } from "../FixturePicker";

describe("FixturePicker", () => {
  it("renders nothing when there is only one fixture", () => {
    const { container } = render(
      <FixturePicker
        fixtures={["default"]}
        active="default"
        onSelect={vi.fn()}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders dropdown when there are multiple fixtures", () => {
    render(
      <FixturePicker
        fixtures={["default", "empty state", "error state"]}
        active="default"
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole("combobox")).toBeDefined();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("calls onSelect when a different fixture is chosen", () => {
    const onSelect = vi.fn();
    render(
      <FixturePicker
        fixtures={["default", "empty state"]}
        active="default"
        onSelect={onSelect}
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "empty state" },
    });
    expect(onSelect).toHaveBeenCalledWith("empty state");
  });
});
