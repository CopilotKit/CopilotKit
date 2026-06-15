/**
 * IR-level tests for the JSX render components. Each component is a
 * `@copilotkit/bot-ui` `ComponentFn`; we assert the `renderToIR(<Comp .../>)`
 * intermediate representation — the component structure, props, text content,
 * and accent colors — rather than the Discord-specific rendering (which is
 * tested in `@copilotkit/bot-discord`).
 *
 * The shared IR path is adapter-agnostic, so these tests stay valid regardless
 * of which platform renders the IR downstream.
 */
import { describe, it, expect } from "vitest";
import { renderToIR } from "@copilotkit/bot-ui";
import type { BotNode } from "@copilotkit/bot-ui";
import { IssueList } from "../issue-list.js";
import { IssueCard } from "../issue-card.js";
import { PageList } from "../page-list.js";

/** Recursively collect all IR nodes of a given type. */
function findAll(nodes: BotNode[], type: string): BotNode[] {
  const out: BotNode[] = [];
  for (const n of nodes) {
    if (n.type === type) out.push(n);
    const children = n.props?.children;
    const childArr = Array.isArray(children)
      ? (children as BotNode[])
      : children &&
          typeof children === "object" &&
          "type" in (children as object)
        ? [children as BotNode]
        : [];
    out.push(...findAll(childArr, type));
  }
  return out;
}

/** Depth-first text content of an IR node. */
function collectText(node: BotNode): string {
  if (node.type === "text") return String(node.props?.value ?? "");
  const children = node.props?.children;
  const childArr = Array.isArray(children)
    ? (children as BotNode[])
    : children && typeof children === "object" && "type" in (children as object)
      ? [children as BotNode]
      : [];
  return childArr.map(collectText).join("");
}

/** Full serialized text of the whole IR tree. */
function treeText(nodes: BotNode[]): string {
  return nodes.map(collectText).join(" ");
}

describe("IssueList component", () => {
  it("renders a header, section with one line per issue, and a count footer", () => {
    const ir = renderToIR(
      <IssueList
        heading="Open"
        issues={[
          {
            identifier: "CPK-101",
            title: "Checkout 500s under load",
            url: "https://linear.app/copilotkit/issue/CPK-101",
            state: "In Progress",
            assignee: "Alem",
            priority: "Urgent",
            updated: "2d ago",
          },
          {
            identifier: "CPK-102",
            title: "Login redirect loop",
            url: "https://linear.app/copilotkit/issue/CPK-102",
            state: "Todo",
            assignee: "Sam",
            priority: "High",
            updated: "5h ago",
          },
        ]}
      />,
    );

    const headers = findAll(ir, "header");
    expect(headers).toHaveLength(1);
    expect(collectText(headers[0]!)).toContain("Open");

    const sections = findAll(ir, "section");
    expect(sections.length).toBeGreaterThanOrEqual(1);
    const sectionText = sections.map(collectText).join("\n");
    expect(sectionText).toContain("CPK-101");
    expect(sectionText).toContain("CPK-102");
    expect(sectionText).toContain("Checkout 500s under load");
    expect(sectionText).toContain("Login redirect loop");
    expect(sectionText).toContain("Alem");
    expect(sectionText).toContain("Sam");
    expect(sectionText).toContain("2d ago");

    const contexts = findAll(ir, "context");
    const footerText = contexts.map(collectText).join(" ");
    expect(footerText).toContain("2 issues");

    // Accent: hottest priority (Urgent) drives the accent.
    const message = findAll(ir, "message");
    expect(message[0]?.props?.accent).toBe("#EB5757");
  });

  it("caps the section at 15 lines and reports the overflow in the footer", () => {
    const issues = Array.from({ length: 20 }, (_, i) => ({
      identifier: `CPK-${i + 1}`,
      title: `Issue ${i + 1}`,
    }));
    const ir = renderToIR(<IssueList heading="Many" issues={issues} />);

    const sections = findAll(ir, "section");
    const sectionText = sections.map(collectText).join("\n");
    const lines = sectionText.split("\n").filter((l) => l.trim());
    expect(lines.length).toBeLessThanOrEqual(15);
    expect(sectionText).toContain("CPK-1");
    expect(sectionText).toContain("CPK-15");
    expect(sectionText).not.toContain("CPK-16");

    const contexts = findAll(ir, "context");
    const footerText = contexts.map(collectText).join(" ");
    expect(footerText).toContain("Showing 15 of 20 issues");
  });

  it("falls back to bold identifier and 'unassigned' when fields are missing", () => {
    const ir = renderToIR(
      <IssueList issues={[{ identifier: "CPK-9", title: "No assignee" }]} />,
    );
    const text = treeText(ir);
    expect(text).toContain("CPK-9");
    expect(text).toContain("unassigned");
    // No urgent/high priority → Linear purple accent.
    const message = findAll(ir, "message");
    expect(message[0]?.props?.accent).toBe("#5E6AD2");
  });
});

describe("IssueCard component", () => {
  it("renders a status header, title, and a fields grid", () => {
    const ir = renderToIR(
      <IssueCard
        identifier="CPK-101"
        title="Checkout 500s under load"
        url="https://linear.app/copilotkit/issue/CPK-101"
        state="In Progress"
        assignee="Alem"
        priority="Urgent"
        team="CPK"
      />,
    );

    const text = treeText(ir);
    // Header: in-progress unicode dot + identifier.
    const headers = findAll(ir, "header");
    expect(collectText(headers[0]!)).toContain("CPK-101");
    expect(collectText(headers[0]!)).toContain("🔵");

    // Title section with the linked title.
    expect(text).toContain("Checkout 500s under load");
    expect(text).toContain("https://linear.app/copilotkit/issue/CPK-101");

    // Fields: status, assignee, priority, team.
    const fields = findAll(ir, "field");
    expect(fields.length).toBeGreaterThanOrEqual(1);
    const fieldsText = fields.map(collectText).join(" ");
    expect(fieldsText).toContain("Assignee");
    expect(fieldsText).toContain("Alem");
    expect(fieldsText).toContain("Priority");
    expect(fieldsText).toContain("Urgent");
    expect(fieldsText).toContain("Status");
    expect(fieldsText).toContain("In Progress");
    expect(fieldsText).toContain("Team");
    expect(fieldsText).toContain("CPK");

    // Footer: "Open in Linear" link.
    expect(text).toContain("Open in Linear");

    // Urgent priority drives the accent.
    const message = findAll(ir, "message");
    expect(message[0]?.props?.accent).toBe("#EB5757");
  });

  it("shows a 'Filed' banner and a check header when justCreated", () => {
    const ir = renderToIR(
      <IssueCard identifier="CPK-200" title="New bug" justCreated />,
    );
    const text = treeText(ir);
    const headers = findAll(ir, "header");
    expect(collectText(headers[0]!)).toContain("✅");
    expect(collectText(headers[0]!)).toContain("CPK-200");
    expect(text).toContain("Filed in Linear");
    // unassigned fallback still renders.
    expect(text).toContain("_unassigned_");
    // No priority/state → Linear purple.
    const message = findAll(ir, "message");
    expect(message[0]?.props?.accent).toBe("#5E6AD2");
  });

  it("appends a divider + trimmed description when present", () => {
    const long = "x".repeat(700);
    const ir = renderToIR(
      <IssueCard identifier="CPK-300" title="Big" description={long} />,
    );
    const dividers = findAll(ir, "divider");
    expect(dividers).toHaveLength(1);
    // Description is trimmed to 600 chars + an ellipsis.
    const text = treeText(ir);
    const descStart = text.indexOf("x".repeat(10));
    expect(descStart).toBeGreaterThan(-1);
    expect(text).toContain("…");
  });
});

describe("PageList component", () => {
  it("renders linked titles, snippets and a count footer", () => {
    const ir = renderToIR(
      <PageList
        heading="Runbooks"
        pages={[
          {
            title: "Auth outage runbook",
            url: "https://www.notion.so/abc",
            snippet: "Steps to mitigate auth provider downtime.",
            edited: "3d ago",
          },
          { title: "No-link page" },
        ]}
      />,
    );

    const text = treeText(ir);
    const headers = findAll(ir, "header");
    expect(collectText(headers[0]!)).toContain("Runbooks");
    expect(text).toContain("Auth outage runbook");
    expect(text).toContain("https://www.notion.so/abc");
    expect(text).toContain("Steps to mitigate auth provider downtime.");
    expect(text).toContain("3d ago");
    expect(text).toContain("No-link page");
    expect(text).toContain("2 pages");
    // Exactly one divider between the two pages.
    const dividers = findAll(ir, "divider");
    expect(dividers).toHaveLength(1);
    // Notion-dark accent.
    const message = findAll(ir, "message");
    expect(message[0]?.props?.accent).toBe("#2F3437");
  });
});
