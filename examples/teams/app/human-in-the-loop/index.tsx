/**
 * Human-in-the-loop demo tools.
 *
 * HITL here is a **blocking frontend tool**: `confirm_write`'s handler calls
 * `await thread.awaitChoice(<ConfirmAction/>)`, which posts the approval card and
 * blocks until the user clicks (resolving to `{confirmed}`). The agent is
 * instructed (system prompt in `app/index.tsx`) to call `confirm_write` BEFORE
 * `send_announcement`, so a consequential action is always gated on a human.
 */
import { z } from "zod";
import { defineBotTool } from "@copilotkit/bot";
import { ConfirmAction } from "./confirm-action.js";

/** The HITL gate: ask the user to approve before a consequential action. */
export const confirmWriteTool = defineBotTool({
  name: "confirm_write",
  description:
    "Ask the user to approve a consequential action before you perform it. " +
    "Posts an approve/reject card and BLOCKS until the user clicks; returns " +
    "{confirmed: boolean}. You MUST call this before send_announcement. Reads " +
    "and chit-chat never need confirmation.",
  parameters: z.object({
    action: z
      .string()
      .describe(
        "One-line summary of what you're about to do, e.g. 'Send announcement to the team'",
      ),
    detail: z
      .string()
      .optional()
      .describe("The specifics being approved: the drafted announcement text"),
  }),
  async handler({ action, detail }, { thread }) {
    const choice = await thread.awaitChoice<{ confirmed?: boolean }>(
      <ConfirmAction action={action} detail={detail} />,
    );
    return choice?.confirmed
      ? "The user APPROVED. Proceed with send_announcement."
      : "The user DECLINED. Do not send; acknowledge and stop.";
  },
});

/** The gated action. Self-contained (mock), with no external API. */
export const sendAnnouncementTool = defineBotTool({
  name: "send_announcement",
  description:
    "Send a team announcement. You MUST have called confirm_write and received " +
    "approval first. Returns a confirmation with a mock message id.",
  parameters: z.object({
    message: z.string().describe("The announcement body to send"),
  }),
  async handler({ message }) {
    // Mock send. A real bot would post to a channel or call an API here.
    const id = `ann_${message.length}_${message.trim().split(/\s+/).length}`;
    return `Announcement sent (id: ${id}). Give the user a one-line confirmation.`;
  },
});

export const hitlTools = [confirmWriteTool, sendAnnouncementTool];
