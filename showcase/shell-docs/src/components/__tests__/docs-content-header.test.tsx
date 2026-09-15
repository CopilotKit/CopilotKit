// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { DocsContentHeader } from "../docs-content-header";

afterEach(cleanup);

it("orders breadcrumbs, title, description, and actions", () => {
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
  const heading = screen.getByRole("heading", { level: 1 });
  const description = screen.getByText(/Primary text input/);
  const action = screen.getByRole("button", { name: "Copy page" });

  expect(heading.textContent).toBe("CopilotChatInput");
  expect(
    heading.compareDocumentPosition(description) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    description.compareDocumentPosition(action) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(action.parentElement?.className).toBe("docs-page-actions-row");
});

it("does not render empty breadcrumb chrome", () => {
  render(<DocsContentHeader ancestorBreadcrumbs={[]} title="Introduction" />);

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
