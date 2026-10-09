// @vitest-environment jsdom

// Behavioural tests for the docs search modal. They drive the real
// component — type into the real input, read the real result rows,
// navigate through the real click handler — so they stay true when
// scoring constants are retuned. Only the ambient wiring (router,
// framework provider, runtime config) is faked.

import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

const pushed: string[] = [];
vi.mock("next/navigation", () => ({
  usePathname: () => "/quickstart",
  useRouter: () => ({
    push: (href: string) => {
      pushed.push(href);
    },
  }),
}));

vi.mock("../framework-provider", () => ({
  DEFAULT_FRAMEWORK: "built-in-agent",
  useFramework: () => ({
    effectiveFramework: "built-in-agent",
    knownFrameworks: [],
    setStoredFramework: () => {},
  }),
}));

import { SearchModal, loadRegistry } from "../search-modal";

// Load the real registry before exercising the search UI.
beforeAll(async () => {
  await loadRegistry();
});

const SHELL_HOST = "https://showcase.copilotkit.test";

function resultRows(): HTMLElement[] {
  const list = screen.queryByRole("listbox", { name: "Search results" });
  if (!list) return [];
  // Scoped to the results listbox on purpose. The recommendation block is a
  // separate one-option listbox of its own, so a page-wide option query
  // would count it as a thirteenth result.
  return within(list).queryAllByRole("option");
}

async function search(query: string): Promise<void> {
  render(<SearchModal onClose={() => {}} />);
  // The framework picker and the docs-folder map come from a dynamically
  // imported registry.json — wait for it before typing so results are
  // built from the same inputs a real user's search sees.
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: /Choose docs framework/ }).textContent,
    ).not.toContain("Loading frameworks"),
  );
  fireEvent.change(screen.getByRole("combobox"), { target: { value: query } });
  await waitFor(() => expect(resultRows().length).toBeGreaterThan(0));
}

beforeEach(() => {
  pushed.length = 0;
  window.__SHOWCASE_CONFIG__ = {
    baseUrl: "https://docs.copilotkit.test/",
    shellUrl: SHELL_HOST,
    intelligenceSignupUrl: "https://ops.copilotkit.test/",
    posthogKey: "",
    posthogHost: "https://posthog.test/",
    scarfPixelId: "",
    googleAnalyticsTrackingId: "",
    reb2bKey: "",
    reoKey: "",
    clerkPublishableKey: "",
  };
});

afterEach(() => {
  cleanup();
  delete window.__SHOWCASE_CONFIG__;
});

// Smoke the real generated index and click handlers without pinning ranking.
it.each(["chat", "tools", "state"])(
  "navigates search results for %s",
  async (query) => {
    await search(query);
    const rows = resultRows();
    for (const row of rows) fireEvent.click(row);
    expect(pushed).toHaveLength(rows.length);
    for (const href of pushed) {
      expect(href).toMatch(/^\/(?!\/)/);
      expect(href).not.toBe("/");
    }
  },
);

it("opens the keyboard-selected result with Enter", async () => {
  await search("chat");
  const input = screen.getByRole("combobox");
  fireEvent.keyDown(input, { key: "ArrowDown" });
  const selected = resultRows().find(
    (row) => row.getAttribute("aria-selected") === "true",
  );
  expect(selected).toBeTruthy();
  fireEvent.keyDown(input, { key: "Enter" });
  const keyboardDestination = pushed[0];
  fireEvent.click(selected!);
  expect(pushed).toEqual([keyboardDestination, keyboardDestination]);
  expect(keyboardDestination).toMatch(/^\/(?!\/)/);
});

function DismissibleSearch() {
  const [open, setOpen] = React.useState(true);
  return open ? <SearchModal onClose={() => setOpen(false)} /> : null;
}

it("closes on Escape", () => {
  render(<DismissibleSearch />);
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("does not navigate when an unrelated query has no results", async () => {
  await search("chat");
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: "zzzzunmatchedqueryzzzz" } });
  await waitFor(() => expect(resultRows()).toHaveLength(0));
  fireEvent.keyDown(input, { key: "Enter" });
  expect(pushed).toEqual([]);
});
