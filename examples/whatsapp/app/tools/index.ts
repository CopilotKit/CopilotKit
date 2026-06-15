/**
 * App-specific frontend tools for the WhatsApp bot. These are the tools the
 * agent can call to render rich replies on WhatsApp. Universal-WhatsApp
 * behavior (formatting/delivery context) ships in the SDK and is spread in
 * `app/index.ts` via `defaultWhatsAppContext`.
 *
 * WhatsApp capabilities are limited to text + interactive reply buttons (≤3)
 * and lists (≤10) — there is no Block Kit, no tables, no charts/diagrams, no
 * message editing/streaming. The Slack example's browser/chart/diagram/table
 * tools are intentionally NOT ported.
 *
 * Every tool is a plain `BotTool`: its handler receives the generic
 * `BotToolContext` and reaches platform power via `thread` methods, so the
 * array assigns straight into `createBot({ tools })`.
 */
import { issueListTool } from "./issue-list.js";
import { showIncidentTool } from "./show-incident.js";
import { confirmWriteTool } from "./confirm-write.js";
import type { BotTool } from "@copilotkit/bot";

export const appTools: BotTool[] = [
  issueListTool,
  showIncidentTool,
  confirmWriteTool,
];

export { issueListTool, showIncidentTool, confirmWriteTool };
