// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  pathname: "/",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { SidebarIntelligenceEntry } from "../sidebar-intelligence-entry";

afterEach(cleanup);

test("pins Intelligence at the top of the sidebar as a docs link", () => {
  navigation.pathname = "/quickstart";
  render(<SidebarIntelligenceEntry />);

  const link = screen.getByRole("link", { name: "Intelligence" });
  expect(link.getAttribute("href")).toBe("/intelligence/overview");
  expect(link.getAttribute("aria-current")).toBeNull();
  expect(link.className).toContain("shell-docs-intelligence-entry");
  expect(link.className).not.toContain("shell-docs-intelligence-entry-active");
  expect(link.querySelector("svg")?.getAttribute("class")).not.toContain(
    "fill-current",
  );
});

test("marks the Intelligence pin current on Intelligence docs", () => {
  navigation.pathname = "/intelligence/overview";
  render(<SidebarIntelligenceEntry />);

  const link = screen.getByRole("link", { name: "Intelligence" });
  expect(link.getAttribute("aria-current")).toBe("page");
  expect(link.className).toContain("shell-docs-intelligence-entry-active");
  expect(link.querySelector("svg")?.getAttribute("class")).not.toContain(
    "fill-current",
  );
});
