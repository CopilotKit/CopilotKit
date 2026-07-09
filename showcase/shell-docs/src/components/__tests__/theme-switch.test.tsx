// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeSwitch } from "@/components/theme-switch";

const themeMock = vi.hoisted(() => ({
  setTheme: vi.fn(),
  theme: "system" as string | undefined,
  resolvedTheme: "dark" as string | undefined,
}));

vi.mock("next-themes", () => ({
  useTheme: () => themeMock,
}));

describe("ThemeSwitch", () => {
  beforeEach(() => {
    themeMock.theme = "system";
    themeMock.resolvedTheme = "dark";
    themeMock.setTheme.mockReset();
  });

  it("announces the stored mode and offers exactly three single-choice options", async () => {
    const user = userEvent.setup();
    render(<ThemeSwitch />);

    const trigger = screen.getByRole("button", { name: "Theme: System" });
    await user.click(trigger);

    const group = screen.getByRole("radiogroup", { name: "Theme" });
    const options = screen.getAllByRole("radio");

    expect(group).toBeTruthy();
    expect(options.map((option) => option.textContent)).toEqual([
      "System",
      "Light",
      "Dark",
    ]);
    expect(
      options.map((option) => option.getAttribute("aria-checked")),
    ).toEqual(["true", "false", "false"]);
  });

  it("supports arrow selection, Escape, and focus restoration", async () => {
    const user = userEvent.setup();
    render(<ThemeSwitch />);

    const trigger = screen.getByRole("button", { name: "Theme: System" });
    await user.click(trigger);
    await user.keyboard("{ArrowDown}");

    expect(themeMock.setTheme).toHaveBeenCalledWith("light");
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("radiogroup", { name: "Theme" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
