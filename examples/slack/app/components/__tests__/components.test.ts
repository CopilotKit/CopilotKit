import { describe, it, expect } from "vitest";
import { issueListComponent } from "../issue-list.js";
import { pageListComponent } from "../page-list.js";

describe("issue_list component", () => {
  it("renders a heading, a status row and a meta context per issue", () => {
    const blocks = issueListComponent.render({
      heading: "Open CPK issues",
      issues: [
        {
          identifier: "CPK-101",
          title: "Checkout 500s under load",
          url: "https://linear.app/copilotkit/issue/CPK-101",
          state: "In Progress",
          assignee: "Alem",
          priority: "Urgent",
        },
      ],
    });

    const json = JSON.stringify(blocks);
    // Heading + divider, then a section row + a context row for the issue.
    expect(blocks[0]).toMatchObject({ type: "section" });
    expect(blocks.some((b) => b.type === "divider")).toBe(true);
    // The identifier is rendered as a Slack mrkdwn link.
    expect(json).toContain(
      "<https://linear.app/copilotkit/issue/CPK-101|CPK-101>",
    );
    expect(json).toContain("Checkout 500s under load");
    // In-progress maps to the blue dot.
    expect(json).toContain(":large_blue_circle:");
    expect(json).toContain("Alem");
  });

  it("falls back to bold identifier and 'unassigned' when fields are missing", () => {
    const blocks = issueListComponent.render({
      issues: [{ identifier: "CPK-9", title: "No assignee" }],
    });
    const json = JSON.stringify(blocks);
    expect(json).toContain("*CPK-9*");
    expect(json).toContain("unassigned");
  });
});

describe("page_list component", () => {
  it("renders page links and snippets", () => {
    const blocks = pageListComponent.render({
      heading: "Runbooks",
      pages: [
        {
          title: "Auth outage runbook",
          url: "https://www.notion.so/abc",
          snippet: "Steps to mitigate auth provider downtime.",
        },
        { title: "No-link page" },
      ],
    });
    const json = JSON.stringify(blocks);
    expect(json).toContain("<https://www.notion.so/abc|Auth outage runbook>");
    expect(json).toContain("Steps to mitigate auth provider downtime.");
    // A page without a url renders as bold text rather than a link.
    expect(json).toContain("*No-link page*");
  });
});
