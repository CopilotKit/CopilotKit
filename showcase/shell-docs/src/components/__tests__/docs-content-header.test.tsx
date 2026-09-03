// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { DocsContentHeader } from "../docs-content-header";

afterEach(cleanup);

it("composes ancestor breadcrumbs and actions around the page title", () => {
  render(
    <DocsContentHeader
      ancestorBreadcrumbs={[
        { label: "Reference", href: "/reference" },
        { label: "Components", href: null },
      ]}
      title="CopilotChatInput"
      description="Primary text input for chat interactions."
    >
      <button type="button">Copy page</button>
    </DocsContentHeader>,
  );

  expect(
    screen.getByRole("navigation", { name: "Breadcrumb" }).textContent,
  ).toContain("Reference");
  expect(
    screen.getByRole("link", { name: "Reference" }).getAttribute("href"),
  ).toBe("/reference");
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
    "CopilotChatInput",
  );
  expect(screen.getByRole("button", { name: "Copy page" })).toBeTruthy();
  expect(screen.getByText(/Primary text input/)).toBeTruthy();
});

it("does not render empty breadcrumb chrome", () => {
  render(
    <DocsContentHeader ancestorBreadcrumbs={[]} title="Introduction" />,
  );

  expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
});

it("keeps breadcrumbs and actions when an MDX hero owns the heading", () => {
  render(
    <DocsContentHeader
      ancestorBreadcrumbs={[{ label: "Deploy", href: null }]}
      title="AWS AgentCore"
      description="Hidden description"
      hideHeading
    >
      <button type="button">Copy prompt</button>
    </DocsContentHeader>,
  );

  expect(
    screen.getByRole("navigation", { name: "Breadcrumb" }).textContent,
  ).toContain("Deploy");
  expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  expect(screen.queryByText("Hidden description")).toBeNull();
  expect(screen.getByRole("button", { name: "Copy prompt" })).toBeTruthy();
});
