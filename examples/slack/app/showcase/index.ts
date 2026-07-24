/**
 * Showcase features — each renders CopilotKit-branded cards (Tailwind classes,
 * resolved from the compiled brand stylesheet — see app/render/brand.ts) +
 * `@copilotkit/channels/charts` as images via Takumi, and each is triggerable
 * BOTH ways: a `defineChannelTool` (the agent calls it from a natural-language
 * prompt) and a `defineChannelCommand` (a deterministic slash command). Both
 * paths share one `render*` fn.
 *
 *   1. PR review radar   — `/prs`     / "show the PR radar"        (GitHub)
 *   2. Weekly OSS pulse  — `/pulse`   / "weekly pulse"            (GitHub + npm)
 *   3. Linear standup    — `/standup` / "cycle standup"          (Linear)
 *
 * Wire `showcaseTools` into `createChannel({ tools })` and `showcaseCommands`
 * into `createChannel({ commands })`.
 */
import type { ChannelTool, ChannelCommand } from "@copilotkit/channels";
import { prRadarTool, prsCommand } from "./pr-radar.js";
import { weeklyPulseTool, pulseCommand } from "./weekly-pulse.js";
import { standupTool, standupCommand } from "./cycle-standup.js";

export { prRadarTool, prsCommand, renderPrRadar } from "./pr-radar.js";
export {
  weeklyPulseTool,
  pulseCommand,
  renderWeeklyPulse,
} from "./weekly-pulse.js";
export { standupTool, standupCommand, renderStandup } from "./cycle-standup.js";

export const showcaseTools: ChannelTool[] = [
  prRadarTool,
  weeklyPulseTool,
  standupTool,
];

export const showcaseCommands: ChannelCommand[] = [
  prsCommand,
  pulseCommand,
  standupCommand,
];
