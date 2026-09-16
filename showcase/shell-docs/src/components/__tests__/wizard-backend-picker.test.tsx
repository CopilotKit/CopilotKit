// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WizardBackendPicker } from "../wizard-backend-picker";

afterEach(cleanup);
it("groups language variants and selects the exact backend before advancing", () => {
  const onSelect = vi.fn();
  render(
    <WizardBackendPicker
      picks={[
        "langgraph-python",
        "langgraph-typescript",
        "langgraph-fastapi",
      ].map((id) => ({
        id,
        name: id,
        summary: "",
        logo: { kind: "framework" as const, slug: id },
      }))}
      onSelect={onSelect}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "LangChain" }));
  expect(onSelect).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Python with FastAPI" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "TypeScript" }));
  expect(onSelect).toHaveBeenCalledWith("langgraph-typescript", false);
});
