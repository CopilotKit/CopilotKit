/**
 * App-specific Slack components — agent-renderable Block Kit cards.
 * Universal-Slack components (if any) would live in `src/`; this is for
 * components specific to this particular bot.
 *
 * Add new components here, re-export through `appComponents`, then wire
 * the array into `createSlackBridge({components: appComponents})`.
 */
import { greetingCardComponent } from "./greeting-card.js";
import type { SlackComponent } from "../../src/index.js";

export const appComponents: ReadonlyArray<SlackComponent> = [
  greetingCardComponent,
];

export { greetingCardComponent };
