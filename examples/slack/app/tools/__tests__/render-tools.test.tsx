/**
 * Render-tool wrappers post the finished JSX component to the thread. We
 * drive each tool's handler with a minimal fake `thread` whose `post` records
 * the posted `Renderable`, then assert that rendering it through the shared
 * `renderToIR` → `renderSlackMessage` path yields the expected Block Kit
 * shape — i.e. the tool posted the right component.
 */
import { describe, it, expect } from "vitest";
import { renderToIR } from "@copilotkit/bot-ui";
import { renderSlackMessage } from "@copilotkit/bot-slack";
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
  return { posts, ctx: { thread, platform: "slack" } as never };
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

    const { blocks } = renderSlackMessage(renderToIR(posts[0] as never));
    expect(blocks[0]).toMatchObject({
      type: "header",
      text: { type: "plain_text", text: "🔵 CPK-101" },
    });
    expect(JSON.stringify(blocks)).toContain(
      "<https://linear.app/copilotkit/issue/CPK-101|*Checkout 500s under load*>",
    );
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

    const { blocks } = renderSlackMessage(renderToIR(posts[0] as never));
    expect(blocks[0]).toMatchObject({
      type: "header",
      text: { type: "plain_text", text: "📋  Open CPK issues" },
    });
    expect(JSON.stringify(blocks)).toContain(
      "<https://linear.app/copilotkit/issue/CPK-101|*CPK-101*>",
    );
    expect(JSON.stringify(blocks)).toContain("1 issue");
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

    const { blocks } = renderSlackMessage(renderToIR(posts[0] as never));
    expect(blocks[0]).toMatchObject({
      type: "header",
      text: { type: "plain_text", text: "📚  Runbooks" },
    });
    expect(JSON.stringify(blocks)).toContain(
      "<https://www.notion.so/abc|*Auth outage runbook*>",
    );
    expect(JSON.stringify(blocks)).toContain("1 page");
  });
});
