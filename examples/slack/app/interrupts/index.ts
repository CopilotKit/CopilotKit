/**
 * App-specific LangGraph interrupt handlers. The Slack-side equivalent
 * of React's `useInterrupt` — each handler describes how to render the
 * picker for one kind of `interrupt()` payload, and how the user's
 * choice maps back to the value the graph's `interrupt()` call returns.
 *
 * Wire into `createSlackBridge({interruptHandlers: appInterruptHandlers})`.
 */
import { scheduleMeetingInterrupt } from "./schedule-meeting.js";

// Infer the array type from the elements — preserves each handler's
// payload + per-action typing.
export const appInterruptHandlers = [scheduleMeetingInterrupt];

export { scheduleMeetingInterrupt };
