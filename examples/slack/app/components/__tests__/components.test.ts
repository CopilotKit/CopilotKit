import { describe, it, expect } from "vitest";
import { issueListComponent } from "../issue-list.js";
import { issueCardComponent } from "../issue-card.js";
import { pageListComponent } from "../page-list.js";

describe("issue_list component", () => {
  it("renders a header, a status row and a meta line per issue", () => {
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
          updated: "2d ago",
        },
      ],
    });

    const json = JSON.stringify(blocks);
    // Leads with a header block.
    expect(blocks[0]).toMatchObject({ type: "header" });
    expect(json).toContain("Open CPK issues");
    // The identifier is a bold mrkdwn link.
    expect(json).toContain(
      "<https://linear.app/copilotkit/issue/CPK-101|*CPK-101*>",
    );
    expect(json).toContain("Checkout 500s under load");
    // In-progress maps to the blue dot; Urgent to the siren.
    expect(json).toContain(":large_blue_circle:");
    expect(json).toContain(":rotating_light:");
    expect(json).toContain("Alem");
    // Count footer.
    expect(json).toContain("1 issue");
  });

  it("puts a divider between issues but not after the last", () => {
    const blocks = issueListComponent.render({
      issues: [
        { identifier: "CPK-1", title: "a" },
        { identifier: "CPK-2", title: "b" },
      ],
    });
    expect(blocks.filter((b) => b.type === "divider")).toHaveLength(1);
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

describe("issue_card component", () => {
  it("renders a status header, linked title and a fields grid", () => {
    const blocks = issueCardComponent.render({
      identifier: "CPK-101",
      title: "Checkout 500s under load",
      url: "https://linear.app/copilotkit/issue/CPK-101",
      state: "In Progress",
      assignee: "Alem",
      priority: "Urgent",
      team: "CPK",
    });

    const json = JSON.stringify(blocks);
    expect(blocks[0]).toMatchObject({ type: "header" });
    expect(json).toContain("CPK-101");
    // A section carries the 2-column metadata grid.
    const fieldsSection = blocks.find(
      (b) => b.type === "section" && "fields" in b && Array.isArray(b.fields),
    );
    expect(fieldsSection).toBeDefined();
    expect(json).toContain("Assignee");
    expect(json).toContain("Alem");
    expect(json).toContain("Priority");
  });

  it("shows a 'Filed' banner and a check header when justCreated", () => {
    const blocks = issueCardComponent.render({
      identifier: "CPK-200",
      title: "New bug",
      justCreated: true,
    });
    const json = JSON.stringify(blocks);
    expect(json).toContain("✅");
    expect(json).toContain("Filed in Linear");
  });
});

describe("page_list component", () => {
  it("renders linked titles, snippets and a count footer", () => {
    const blocks = pageListComponent.render({
      heading: "Runbooks",
      pages: [
        {
          title: "Auth outage runbook",
          url: "https://www.notion.so/abc",
          snippet: "Steps to mitigate auth provider downtime.",
          edited: "3d ago",
        },
        { title: "No-link page" },
      ],
    });
    const json = JSON.stringify(blocks);
    expect(blocks[0]).toMatchObject({ type: "header" });
    expect(json).toContain("<https://www.notion.so/abc|*Auth outage runbook*>");
    expect(json).toContain("Steps to mitigate auth provider downtime.");
    // A page without a url renders as bold text rather than a link.
    expect(json).toContain("*No-link page*");
    expect(json).toContain("2 pages");
  });
});
