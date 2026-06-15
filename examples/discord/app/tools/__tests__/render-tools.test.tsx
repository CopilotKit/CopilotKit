/**
 * Render-tool wrappers post the finished JSX component to the thread. We
 * drive each tool's handler with a minimal fake `thread` whose `post` records
 * the posted `Renderable`, then assert that rendering it through `renderToIR`
 * yields the expected IR shape — i.e. the tool posted the right component.
 */
import { describe, it, expect } from "vitest";
import { renderToIR } from "@copilotkit/bot-ui";
import type { BotNode } from "@copilotkit/bot-ui";
import { issueCardTool, issueListTool, pageListTool } from "../render-tools.js";

/** A fake `thread` that records each posted Renderable. */
function fakeThread() {
  const posts: unknown[] = [];
  const thread = {
    post: async (ui: unknown) => {
      posts.push(ui);
      return { id: "m1" };
    },
  };
  return { posts, ctx: { thread, platform: "discord" } as never };
}

/** Depth-first text content of an IR tree. */
function treeText(nodes: BotNode[]): string {
  function collectText(node: BotNode): string {
    if (node.type === "text") return String(node.props?.value ?? "");
    const children = node.props?.children;
    const childArr = Array.isArray(children)
      ? (children as BotNode[])
      : children &&
          typeof children === "object" &&
          "type" in (children as object)
        ? [children as BotNode]
        : [];
    return childArr.map(collectText).join("");
  }
  return nodes.map(collectText).join(" ");
}

describe("issue_card render-tool", () => {
  it("posts an IssueCard rendering to a header + linked title", async () => {
    const { posts, ctx } = fakeThread();
    const result = await issueCardTool.handler(
      {
        identifier: "CPK-101",
        title: "Checkout 500s under load",
        url: "https://linear.app/copilotkit/issue/CPK-101",
        state: "In Progress",
        assignee: "Alem",
        priority: "Urgent",
      },
      ctx,
    );

    expect(posts).toHaveLength(1);
    expect(result).toBe("Displayed the issue card to the user.");

    const ir = renderToIR(posts[0] as never);
    const text = treeText(ir);
    expect(text).toContain("CPK-101");
    expect(text).toContain("🔵"); // In Progress state dot
    expect(text).toContain("Checkout 500s under load");
    expect(text).toContain("https://linear.app/copilotkit/issue/CPK-101");
  });
});

describe("issue_list render-tool", () => {
  it("posts an IssueList rendering to a header + one row per issue", async () => {
    const { posts, ctx } = fakeThread();
    const result = await issueListTool.handler(
      {
        heading: "Open CPK issues",
        issues: [
          {
            identifier: "CPK-101",
            title: "Checkout 500s under load",
            url: "https://linear.app/copilotkit/issue/CPK-101",
            state: "In Progress",
          },
        ],
      },
      ctx,
    );

    expect(posts).toHaveLength(1);
    expect(result).toBe("Displayed the issue list to the user.");

    const ir = renderToIR(posts[0] as never);
    const text = treeText(ir);
    expect(text).toContain("Open CPK issues");
    expect(text).toContain("CPK-101");
    expect(text).toContain("https://linear.app/copilotkit/issue/CPK-101");
    expect(text).toContain("1 issue");
  });
});

describe("page_list render-tool", () => {
  it("posts a PageList rendering to a header + one row per page", async () => {
    const { posts, ctx } = fakeThread();
    const result = await pageListTool.handler(
      {
        heading: "Runbooks",
        pages: [
          {
            title: "Auth outage runbook",
            url: "https://www.notion.so/abc",
            snippet: "Steps to mitigate auth provider downtime.",
          },
        ],
      },
      ctx,
    );

    expect(posts).toHaveLength(1);
    expect(result).toBe("Displayed the Notion pages to the user.");

    const ir = renderToIR(posts[0] as never);
    const text = treeText(ir);
    expect(text).toContain("Runbooks");
    expect(text).toContain("Auth outage runbook");
    expect(text).toContain("https://www.notion.so/abc");
    expect(text).toContain("1 page");
  });
});
