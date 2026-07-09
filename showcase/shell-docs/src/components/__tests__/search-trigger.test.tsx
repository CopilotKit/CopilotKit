// @vitest-environment jsdom

import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SearchTrigger,
  ShellSearchProvider,
} from "@/components/search-trigger";
import { renderWithFumadocs } from "@/test/render-with-fumadocs";

const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => navigation,
}));

vi.mock("@/components/framework-provider", () => ({
  DEFAULT_FRAMEWORK: "built-in-agent",
  useFramework: () => ({
    effectiveFramework: "built-in-agent",
    setStoredFramework: vi.fn(),
  }),
}));

vi.mock("@/lib/runtime-config.client", () => ({
  getRuntimeConfig: () => ({ shellUrl: "https://showcase.test" }),
}));

describe("shell search triggers", () => {
  beforeEach(() => {
    navigation.push.mockReset();
  });

  it("shares dialog state across full and icon trigger variants", async () => {
    const user = userEvent.setup();
    renderWithFumadocs(
      <ShellSearchProvider>
        <SearchTrigger variant="full" />
        <SearchTrigger variant="icon" />
      </ShellSearchProvider>,
      navigation,
    );

    const triggers = screen.getAllByRole("button", {
      name: "Search documentation",
    });
    expect(triggers).toHaveLength(2);
    expect(triggers[0].className).toContain("h-11");
    expect(triggers[1].className).toContain("h-11");

    await user.click(triggers[0]);

    expect(screen.getByRole("dialog", { name: "Search" })).toBeTruthy();
    expect(
      triggers.map((trigger) => trigger.getAttribute("aria-expanded")),
    ).toEqual(["true", "true"]);

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();
    });
    expect(document.activeElement).toBe(triggers[0]);
  });

  it("opens on Cmd/Ctrl+K without hijacking unrelated editable controls", async () => {
    renderWithFumadocs(
      <ShellSearchProvider>
        <label>
          Notes
          <textarea />
        </label>
        <SearchTrigger variant="icon" />
      </ShellSearchProvider>,
      navigation,
    );

    const editor = screen.getByRole("textbox", { name: "Notes" });
    editor.focus();
    fireEvent.keyDown(editor, { key: "k", metaKey: true });
    expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();

    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
    expect(await screen.findByRole("dialog", { name: "Search" })).toBeTruthy();
  });

  it("closes from the overlay and restores focus to the opener", async () => {
    const user = userEvent.setup();
    renderWithFumadocs(
      <ShellSearchProvider>
        <SearchTrigger variant="icon" />
      </ShellSearchProvider>,
      navigation,
    );

    const trigger = screen.getByRole("button", {
      name: "Search documentation",
    });
    await user.click(trigger);
    await user.click(screen.getByTestId("search-overlay"));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });
  });
});
