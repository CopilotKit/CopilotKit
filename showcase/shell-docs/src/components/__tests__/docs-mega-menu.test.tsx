// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/quickstart",
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { DocsMegaMenu } from "../docs-mega-menu";

afterEach(cleanup);

test("opens a five-column docs map with Intelligence featured", () => {
  render(<DocsMegaMenu triggerClassName="shell-docs-nav-link-active" />);

  fireEvent.pointerEnter(screen.getByRole("button", { name: "Explore docs" }));

  expect(screen.getByRole("navigation", { name: "Explore docs" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Start" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Build" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Connect" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Ship & Operate" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Reference" })).toBeTruthy();

  const intelligence = screen.getByRole("link", { name: /Intelligence/ });
  expect(intelligence.getAttribute("href")).toBe("/intelligence/overview");
  expect(intelligence.className).toContain(
    "shell-docs-mega-menu-link-featured",
  );
});
