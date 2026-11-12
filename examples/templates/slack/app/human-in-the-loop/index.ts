/**
 * App-specific human-in-the-loop components — interactive Block Kit cards the
 * agent can render to ask the user a structured question and wait for the
 * answer.
 *
 * `confirm_write` is now a JSX component (`ConfirmWrite`) used as a BLOCKING
 * FRONTEND TOOL: a tool handler calls `await thread.awaitChoice(<ConfirmWrite
 * .../>)` (wired in a later wave), which posts the picker and resolves to the
 * clicked button's `value`. Add new HITL components here and re-export them.
 */
export { ConfirmWrite } from "./confirm-write.js";
export type { ConfirmWriteProps } from "./confirm-write.js";
export { confirmWriteTool, confirmWriteSchema } from "./confirm-write-tool.js";
