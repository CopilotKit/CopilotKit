/**
 * `confirm_write` — the agent-facing write-gate TOOL.
 *
 * The migration kept the {@link ConfirmWrite} JSX card but this tool is what
 * makes the system prompt's contract real: "call the confirm_write tool before
 * any Linear/Notion write". In the new model HITL is a BLOCKING FRONTEND TOOL —
 * the handler calls `await thread.awaitChoice(<ConfirmWrite .../>)`, which posts
 * the picker and BLOCKS until the user clicks Create/Cancel, then resolves to
 * the clicked button's `value` (`{ confirmed: boolean }`). The agent only
 * performs the write once this returns `{ confirmed: true }`.
 */
import { z } from "zod";
import { defineBotTool } from "@copilotkit/bot";
import { ConfirmWrite } from "./confirm-write.js";

export const confirmWriteSchema = z.object({
  action: z
    .string()
    .describe(
      "One-line summary of exactly what you are about to write, e.g. 'Create Linear issue: CPK-123 — Checkout 500s'",
    ),
  detail: z
    .string()
    .optional()
    .describe(
      "Optional detail block shown under the prompt, e.g. the drafted title + description/outline",
    ),
});

export const confirmWriteTool = defineBotTool({
  name: "confirm_write",
  description:
    "Ask the user to approve a write before you perform it. Posts a " +
    "confirm/cancel card and BLOCKS until the user clicks; returns " +
    "{confirmed: boolean}. You MUST call this before creating or modifying " +
    "anything in Linear or Notion. Reads never need confirmation.",
  parameters: confirmWriteSchema,
  async handler({ action, detail }, { thread }) {
    const choice = await thread.awaitChoice<{ confirmed?: boolean }>(
      <ConfirmWrite action={action} detail={detail} />,
    );
    return choice?.confirmed
      ? "The user APPROVED the write — proceed."
      : "The user DECLINED — do not write; acknowledge and stop.";
  },
});
