/**
 * App-specific Slack components — agent-renderable Block Kit cards.
 *
 * Add new components here, re-export through `appComponents`, then wire
 * the array into `createSlackBridge({components: appComponents})`.
 */
import { issueListComponent } from "./issue-list.js";
import { pageListComponent } from "./page-list.js";
import type { SlackComponent } from "@copilotkit/slack";

export const appComponents: ReadonlyArray<SlackComponent> = [
  issueListComponent,
  pageListComponent,
];

export { issueListComponent, pageListComponent };
