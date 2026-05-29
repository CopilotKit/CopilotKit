/**
 * App-specific human-in-the-loop components — interactive Block Kit
 * cards the agent can render to ask the user a structured question and
 * wait for the answer.
 *
 * Add new HITL components here, re-export them through `appHitl`, then
 * wire the array into `createSlackBridge({humanInTheLoopComponents:
 * appHitl})` in `app/index.ts`.
 */
import { confirmHitl } from "./confirm.js";

// Infer the array type from the elements — preserves each handler's
// per-action payload typing all the way to the SDK's bridge config,
// which uses `HumanInTheLoop<any, any>` so the assignment widens cleanly.
export const appHitl = [confirmHitl];

export { confirmHitl };
