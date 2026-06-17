/**
 * Render-tools — the agent-facing wrappers that turn the JSX render
 * components into `BotTool`s. The agent calls `issue_card` / `issue_list` /
 * `page_list`; each handler renders the finished `@copilotkit/bot-ui`
 * component (`<IssueCard … />` etc.) and posts it to the thread via
 * `thread.post`. The tool NAMES, descriptions and input schemas preserve the
 * legacy `componentToFrontendTool(defineSlackComponent(...))` contract.
 */
import { defineBotTool } from "@copilotkit/bot";
import {
  IssueCard,
  IssueList,
  PageList,
  issueCardSchema,
  issueListSchema,
  pageListSchema,
} from "../components/index.js";

export const issueCardTool = defineBotTool({
  name: "issue_card",
  description:
    "Render ONE Linear issue as a rich Block Kit card with a status header, " +
    "the title as a link, and a metadata grid (status, assignee, priority, " +
    "team, cycle, updated) plus optional description and labels. Use for a " +
    "single issue, or right after creating one (set justCreated: true).",
  parameters: issueCardSchema,
  async handler(props, { thread }) {
    await thread.post(<IssueCard {...props} />);
    return "Displayed the issue card to the user.";
  },
});

export const issueListTool = defineBotTool({
  name: "issue_list",
  description:
    "Render a list of Linear issues as a Block Kit card — a header plus one " +
    "row per issue (status dot, linked identifier, title, and a meta line " +
    "with assignee/priority/updated). Use this whenever you're showing the " +
    "user multiple issues you pulled from Linear instead of writing them out " +
    "as prose. For a single issue, use issue_card.",
  parameters: issueListSchema,
  async handler(props, { thread }) {
    await thread.post(<IssueList {...props} />);
    return "Displayed the issue list to the user.";
  },
});

export const pageListTool = defineBotTool({
  name: "page_list",
  description:
    "Render a list of Notion pages as a Block Kit card — a header plus one " +
    "row per page (linked title, a snippet, and optional last-edited). Use " +
    "this whenever you're showing the user pages you found in Notion instead " +
    "of writing them out as prose.",
  parameters: pageListSchema,
  async handler(props, { thread }) {
    await thread.post(<PageList {...props} />);
    return "Displayed the Notion pages to the user.";
  },
});
