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

test("opens the docs menu with working guide destinations", () => {
  render(<DocsMegaMenu triggerClassName="shell-docs-nav-link-active" />);

  fireEvent.pointerEnter(screen.getByRole("button", { name: "Docs" }));

  expect(screen.getByRole("navigation", { name: "Docs" })).toBeTruthy();

  const intelligence = screen.getByRole("link", { name: /Intelligence/ });
  expect(intelligence.getAttribute("href")).toBe("/intelligence/overview");
  expect(
    screen.getByRole("link", { name: "AG-UI Streams" }).getAttribute("href"),
  ).toBe("/threads");
  expect(
    screen.getByRole("link", { name: "User Memories" }).getAttribute("href"),
  ).toBe("/intelligence/memories");
  expect(
    screen
      .getByRole("link", { name: "Automatic Learning" })
      .getAttribute("href"),
  ).toBe("/learning");
  expect(
    screen
      .getByRole("link", { name: "Product Analytics" })
      .getAttribute("href"),
  ).toBe("/intelligence/analytics");
});
