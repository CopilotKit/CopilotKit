/**
 * App-specific frontend tools — anything that's bot-specific, not
 * universal-Slack. Universal-Slack stuff (tagging, formatting,
 * conversation model) lives in the SDK and is auto-included by
 * `defaultSlackTools` (spread in `app/index.ts`).
 *
 * Add new tools here and re-export them through `appTools`. Wire the
 * array into `createSlackBridge({tools: [...defaultSlackTools, ...appTools]})`
 * in `app/index.ts`.
 */
import { readThreadTool } from "./read-thread.js";
import { renderChartTool } from "./render-chart.js";
import { renderDiagramTool } from "./render-diagram.js";
import { renderTableTool } from "./render-table.js";
import type { FrontendTool } from "@copilotkit/slack";

export const appTools: ReadonlyArray<FrontendTool> = [
  readThreadTool,
  renderChartTool,
  renderDiagramTool,
  renderTableTool,
];

export { readThreadTool, renderChartTool, renderDiagramTool, renderTableTool };
