// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  pathname: "/vue",
  replace: vi.fn(),
  setStoredFramework: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: navigation.replace }),
}));
vi.mock("posthog-js/react", () => ({ usePostHog: () => null }));
vi.mock("../framework-provider", () => ({
  DEFAULT_FRAMEWORK: "built-in-agent",
  useFramework: () => ({
    effectiveFramework: "built-in-agent",
    setStoredFramework: navigation.setStoredFramework,
  }),
}));
import { FrameworkSelector } from "../framework-selector";

const options = [
  {
    slug: "built-in-agent",
    name: "CopilotKit",
    category: "core",
    deployed: true,
  },
  {
    slug: "mastra",
    name: "Mastra",
    category: "agent-frameworks",
    deployed: true,
  },
];
const renderSelector = () =>
  render(
    <FrameworkSelector
      options={options}
      categoryOrder={[]}
      variant="sidebar"
    />,
  );
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("switches backend while preserving the frontend", () => {
  renderSelector();
  fireEvent.click(screen.getByRole("button", { name: "Choose agent backend" }));
  fireEvent.click(screen.getByRole("option", { name: /Mastra/ }));
  expect(navigation.setStoredFramework).toHaveBeenCalledWith("mastra");
  expect(navigation.replace).toHaveBeenCalledWith("/vue/mastra");
});

it("switches frontend from the picker", () => {
  renderSelector();
  fireEvent.click(screen.getByRole("button", { name: "Choose frontend" }));
  fireEvent.click(screen.getByRole("option", { name: /^React$/ }));
  expect(navigation.replace).toHaveBeenCalledWith("/");
});

it("closes the picker on Escape", () => {
  renderSelector();
  fireEvent.click(screen.getByRole("button", { name: "Choose frontend" }));
  expect(screen.getByRole("listbox")).toBeTruthy();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull();
});
