/**
 * App-specific frontend tools — anything that's bot-specific, not
 * universal-Slack. Universal-Slack stuff (tagging, formatting,
 * conversation model) lives in `src/middlewares/` and is auto-included
 * by `createSlackBridge`.
 *
 * Add new tools here and re-export them through `appTools`. Wire the
 * array into `createSlackBridge({tools: appTools})` in
 * `app/index.ts`.
 */
import { helloWorldTool } from "./hello-world.js";
import type { FrontendTool } from "../../src/index.js";

export const appTools: ReadonlyArray<FrontendTool> = [helloWorldTool];

export { helloWorldTool };
