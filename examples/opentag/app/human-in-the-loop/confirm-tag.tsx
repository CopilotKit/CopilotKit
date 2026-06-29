/**
 * `confirm_tag` — the human-in-the-loop gate in front of applying a tag.
 * Applying a tag is a "write", so the agent (see the system prompt in
 * `runtime.ts`) must call `confirm_tag` first: the handler calls
 * `await thread.awaitChoice(<ConfirmTag .../>)`, which posts this Apply/Cancel
 * card and **blocks until the user clicks**, resolving to the clicked button's
 * `value` (`{ confirmed: true | false }`). The agent applies the tag (via
 * `tag_card`) only when this returns `{ confirmed: true }`.
 *
 * Each button also carries an `onClick` that updates the card in place to a
 * resolved/declined state — so the card reflects the decision the moment it's
 * clicked. This is the bot-side equivalent of React's `useHumanInTheLoop`,
 * expressed as plain JSX over the cross-platform bot-ui vocabulary.
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
import type { InteractionContext } from "@copilotkit/bot-ui";
import { defineBotTool } from "@copilotkit/bot";

export interface ConfirmTagProps {
  /** The label about to be applied, e.g. 'bug'. */
  label: string;
  /** One-line reason the label fits. */
  rationale: string;
}

export function ConfirmTag({ label, rationale }: ConfirmTagProps) {
  return (
    <Message accent="#E2B340">
      <Header>{`🏷️ Apply tag \`${label}\`?`}</Header>
      <Section>{rationale}</Section>
      <Context>{"🔒  No tag is applied until you click **Apply**."}</Context>
      <Actions>
        <Button
          value={{ confirmed: true }}
          style="primary"
          onClick={async ({ thread, message }: InteractionContext) => {
            await thread.update(
              message.ref,
              <Message accent="#27AE60">
                <Header>{`✅ Applying \`${label}\``}</Header>
                <Context>{"✅  Approved — applying the tag."}</Context>
              </Message>,
            );
          }}
        >
          Apply
        </Button>
        <Button
          value={{ confirmed: false }}
          style="danger"
          onClick={async ({ thread, message }: InteractionContext) => {
            await thread.update(
              message.ref,
              <Message accent="#EB5757">
                <Header>{`🚫 Tag \`${label}\` not applied`}</Header>
                <Context>{"🚫  Declined — no tag was applied."}</Context>
              </Message>,
            );
          }}
        >
          Cancel
        </Button>
      </Actions>
    </Message>
  );
}

export const confirmTagSchema = z.object({
  label: z
    .string()
    .describe("The single label you propose to apply, e.g. 'bug'."),
  rationale: z
    .string()
    .describe(
      "One-line reason this label fits, grounded in the thread you read.",
    ),
});

export const confirmTagTool = defineBotTool({
  name: "confirm_tag",
  description:
    "Ask the user to approve applying a tag before you apply it. Posts an " +
    "Apply/Cancel card and BLOCKS until the user clicks; returns " +
    "{confirmed: boolean}. You MUST call this before applying any tag.",
  parameters: confirmTagSchema,
  async handler({ label, rationale }, { thread }) {
    const choice = await thread.awaitChoice<{ confirmed?: boolean }>(
      <ConfirmTag label={label} rationale={rationale} />,
    );
    return choice?.confirmed
      ? "The user APPROVED — apply the tag now by calling tag_card."
      : "The user DECLINED — do not apply the tag; acknowledge briefly and stop.";
  },
});
