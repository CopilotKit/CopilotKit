/**
 * `confirm_write` — the agent-facing write-gate TOOL.
 *
 * HITL here is NON-BLOCKING. The handler posts the {@link ConfirmWrite} card and
 * returns immediately; the buttons carry the behaviour. Clicking one arrives
 * later as its own interaction turn, which updates the card in place and — on
 * approval — resumes the agent to perform the write.
 *
 * It deliberately does NOT use `thread.awaitChoice`. That helper parks an
 * in-memory waiter and blocks the turn until a click resolves it, which cannot
 * work on a managed Channel: each turn is its own bounded delivery, and the
 * click arrives as a separate delivery that may not even land in this process.
 * Managed adapters advertise this by reporting `supportsBlockingChoice: false`.
 * The interaction path below behaves the same on every surface, so there is one
 * code path rather than one per adapter.
 */
import { z } from "zod";
import { defineChannelTool } from "@copilotkit/channels";
import { ConfirmWrite } from "./confirm-write.js";

export const confirmWriteSchema = z.object({
  action: z
    .string()
    .describe(
      "One-line summary of exactly what you are about to write, e.g. 'Create Linear issue: CPK-123 — Checkout 500s'",
    ),
  detail: z
    .string()
    .nullish()
    .describe(
      "Optional detail block shown under the prompt, e.g. the drafted title + description/outline",
    ),
});

export const confirmWriteTool = defineChannelTool({
  name: "confirm_write",
  description:
    "Ask the user to approve a write before you perform it. Posts a " +
    "confirm/cancel card and returns immediately — it does NOT wait. Stop " +
    "your turn after calling it: if the user approves, you are resumed " +
    "automatically with the approval. You MUST call this before creating or " +
    "modifying anything in Linear or Notion. Reads never need confirmation.",
  parameters: confirmWriteSchema,
  async handler({ action, detail }, { thread }) {
    await thread.post(
      <ConfirmWrite action={action} detail={detail ?? undefined} />,
    );
    return (
      `Approval requested for: ${action}. The confirm/cancel card is posted. ` +
      "Do NOT write anything now and do not ask again in this turn — end your " +
      "turn here. You will be resumed with the user's decision when they click."
    );
  },
});
