/**
 * `confirm_write` — the human-in-the-loop write-gate TOOL.
 *
 * HITL here is a BLOCKING FRONTEND TOOL: the handler calls
 * `await thread.awaitChoice(<ConfirmWrite .../>)`, which posts a confirm/cancel
 * card (two WhatsApp reply buttons) and BLOCKS until the user taps one, then
 * resolves to the clicked button's `value` (`{ confirmed: boolean }`). The
 * agent performs the write only when this returns `{ confirmed: true }`.
 *
 * WhatsApp messages cannot be edited, so — unlike the Slack example — the
 * buttons do NOT update the picker in place; the resolved state is conveyed by
 * the tool's natural-language return and any follow-up the agent posts.
 */
import { z } from "zod";
import {
  Message,
  Header,
  Section,
  Context,
  Actions,
  Button,
} from "@copilotkit/bot-ui";
import { defineBotTool } from "@copilotkit/bot";

export interface ConfirmWriteProps {
  /** Short imperative title of the write, e.g. 'Create Linear issue'. */
  action: string;
  /** The specifics being approved — issue title + one-line description, etc. */
  detail?: string;
}

export function ConfirmWrite({ action, detail }: ConfirmWriteProps) {
  return (
    <Message accent="#E2B340">
      <Header>{`📝 ${action}?`}</Header>
      {detail ? <Section>{detail}</Section> : null}
      <Context>{"🔒 Nothing is written until you tap *Confirm*."}</Context>
      <Actions>
        <Button value={{ confirmed: true }} style="primary">
          Confirm
        </Button>
        <Button value={{ confirmed: false }} style="danger">
          Cancel
        </Button>
      </Actions>
    </Message>
  );
}

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
    "confirm/cancel card and BLOCKS until the user taps a button; returns " +
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
