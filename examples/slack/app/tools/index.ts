/**
 * App-specific frontend tools — anything that's bot-specific, not
 * universal-Slack. Universal-Slack stuff (tagging, formatting,
 * conversation model) lives in the SDK and is auto-included by
 * `defaultSlackTools` (spread in `app/index.ts`).
 *
 * Add new tools here and re-export them through `appTools`. Wire the
 * array into `createChannel({tools: [...defaultSlackTools, ...appTools]})`
 * in `app/index.ts`.
 */
import { readThreadTool } from "./read-thread.js";
import { renderTableTool } from "./render-table.js";
import { renderMrrTool } from "./render-mrr.js";
import { issueCardTool, issueListTool, pageListTool } from "./render-tools.js";
import {
  showIncidentTool,
  showStatusTool,
  showLinksTool,
} from "./showcase-tools.js";
import { confirmWriteTool } from "../human-in-the-loop/index.js";
import { showcaseTools } from "../showcase/index.js";
import type { ChannelTool } from "@copilotkit/channels";

/**
 * Every tool is a plain `ChannelTool`: its handler receives the generic
 * `ChannelToolContext` (`{ thread, message?, user?, signal?, platform }`) the
 * adapter supplies at call time. Platform power (post/stream/postFile,
 * `thread.getMessages()`, `thread.lookupUser()`, …) is reached via the
 * `thread` methods, so there's no per-adapter context and no cast needed —
 * the array assigns straight into `createChannel({ tools })`.
 */
export const appTools: ChannelTool[] = [
  readThreadTool,
  renderTableTool,
  renderMrrTool,
  issueCardTool,
  issueListTool,
  pageListTool,
  showIncidentTool,
  showStatusTool,
  showLinksTool,
  confirmWriteTool,
  // Showcase features (each also has a slash command in app/commands): PR
  // review radar, weekly OSS pulse, Linear cycle standup.
  ...showcaseTools,
];

export {
  readThreadTool,
  renderTableTool,
  renderMrrTool,
  issueCardTool,
  issueListTool,
  pageListTool,
  showIncidentTool,
  showStatusTool,
  showLinksTool,
  confirmWriteTool,
};
