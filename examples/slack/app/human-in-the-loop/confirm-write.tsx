/**
 * `confirm_write` — the human-in-the-loop gate in front of every Linear /
 * Notion write. The agent is instructed (see the system prompt in `runtime.ts`)
 * to confirm BEFORE creating an issue or a page.
 *
 * HITL is NON-BLOCKING: `confirm_write` posts this card and ends its turn. The
 * behaviour lives on the buttons. A click arrives later as its own interaction
 * turn, which updates the card in place — even minutes later, the "approve 20
 * minutes later" durability story — and on approval resumes the agent.
 *
 * Approval walks the card through three states so the click is never ambiguous:
 * pending → working → done/failed. The working state is written BEFORE the
 * agent runs, because it is the user's only feedback that the click landed; the
 * buttons are dropped at the same time so a second click cannot double-write.
 *
 * The Slack-side equivalent of React's `useHumanInTheLoop`, expressed as a
 * plain JSX component over the cross-platform bot-ui vocabulary.
 */
import {
  Message,
  Header,
  Section,
  Context,
  Actions,
  Button,
} from "@copilotkit/channels";
import type { InteractionContext } from "@copilotkit/channels";

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
      <Context>{"🔒  Nothing is written until you click **Create**."}</Context>
      <Actions>
        <Button
          value={{ confirmed: true }}
          style="primary"
          onClick={async ({ thread, message }: InteractionContext) => {
            // Working state first: Discord stops its own button spinner as soon
            // as the interaction is acknowledged, so without this the card would
            // look untouched while the agent runs.
            await thread.update(
              message.ref,
              <Message accent="#E2B340">
                <Header>{`⏳ ${action}`}</Header>
                {detail ? <Section>{detail}</Section> : null}
                <Context>{"⏳  Approved — creating now…"}</Context>
              </Message>,
            );

            try {
              // The approval is stated as fact so the model does not re-ask for
              // permission it already has.
              await thread.runAgent({
                prompt:
                  `The user APPROVED this write: ${action}.` +
                  (detail ? `\n\n${detail}` : "") +
                  "\n\nPerform the write now without asking again, then report " +
                  "the result. Do not call confirm_write for this action again.",
              });

              await thread.update(
                message.ref,
                <Message accent="#27AE60">
                  <Header>{`✅ ${action}`}</Header>
                  {detail ? <Section>{detail}</Section> : null}
                  <Context>{"✅  Done — see the reply below."}</Context>
                </Message>,
              );
            } catch (err) {
              // A failed write must not leave the card claiming it is still
              // working; say so on the card itself, not only in the logs.
              console.error("[confirm-write] approved run failed", err);
              await thread.update(
                message.ref,
                <Message accent="#EB5757">
                  <Header>{`⚠️ ${action}`}</Header>
                  {detail ? <Section>{detail}</Section> : null}
                  <Context>{"⚠️  Failed — nothing was written."}</Context>
                </Message>,
              );
            }
          }}
        >
          Create
        </Button>
        <Button
          value={{ confirmed: false }}
          style="danger"
          onClick={async ({ thread, message }: InteractionContext) => {
            await thread.update(
              message.ref,
              <Message accent="#EB5757">
                <Header>{`🚫 ${action}`}</Header>
                <Context>{"🚫  Declined — nothing was written."}</Context>
              </Message>,
            );
            // No agent run on decline: the card already says what happened, and
            // resuming would only invite the model to re-litigate the refusal.
          }}
        >
          Cancel
        </Button>
      </Actions>
    </Message>
  );
}
