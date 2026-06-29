/**
 * App-specific frontend tools. Add new tools here and re-export them through
 * `appTools`, then wire the array into
 * `createBot({ tools: [...defaultSlackTools, ...appTools] })` in `app/index.ts`.
 *
 * Every tool is a plain `BotTool`: its handler receives the generic
 * `BotToolContext` (`{ thread, message?, user?, signal?, platform }`) the
 * adapter supplies at call time. Platform power (post, `thread.getMessages()`,
 * `thread.awaitChoice()`, …) is reached via the `thread` methods, so there's no
 * per-adapter context and no cast needed — the array assigns straight into
 * `createBot({ tools })`.
 */
import { readThreadTool } from "./read-thread.js";
import { tagCardTool } from "./tag-card.js";
import { confirmTagTool } from "../human-in-the-loop/index.js";
import type { BotTool } from "@copilotkit/bot";

export const appTools: BotTool[] = [
  readThreadTool,
  confirmTagTool,
  tagCardTool,
];

export { readThreadTool, tagCardTool, confirmTagTool };
