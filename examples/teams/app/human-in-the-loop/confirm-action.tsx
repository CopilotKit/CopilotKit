/**
 * The human-in-the-loop approval card. A tool handler calls
 * `await thread.awaitChoice(<ConfirmAction .../>)`, which posts this interactive
 * Adaptive Card and **blocks until the user clicks Approve or Reject** (even
 * minutes later), resolving to the clicked button's `value` (`{confirmed}`).
 *
 * Each button also carries an `onClick` that updates the card in place to a
 * resolved (green) or declined (red) state, so the card reflects the decision the
 * moment it's clicked. This is the cross-platform `bot-ui` equivalent of React's
 * `useHumanInTheLoop`: the same JSX renders as an Adaptive Card on Teams and a
 * Block Kit message on Slack.
 */
import {
  Message,
  Header,
  Section,
  Context,
  Actions,
  Button,
} from "@copilotkit/bot-ui";
import type { InteractionContext } from "@copilotkit/bot-ui";

export interface ConfirmActionProps {
  /** Short imperative title of the action, e.g. 'Send announcement'. */
  action: string;
  /** The specifics being approved: the drafted announcement text, etc. */
  detail?: string;
}

export function ConfirmAction({ action, detail }: ConfirmActionProps) {
  return (
    <Message accent="#E2B340">
      <Header>{`📣 ${action}?`}</Header>
      {detail ? <Section>{detail}</Section> : null}
      <Context>{"🔒 Nothing is sent until you click **Approve**."}</Context>
      <Actions>
        <Button
          value={{ confirmed: true }}
          style="primary"
          onClick={async ({ thread, message }: InteractionContext) => {
            await thread.update(
              message.ref,
              <Message accent="#27AE60">
                <Header>{`✅ ${action}`}</Header>
                <Context>{"✔️ Approved. Sending now."}</Context>
              </Message>,
            );
          }}
        >
          Approve
        </Button>
        <Button
          value={{ confirmed: false }}
          style="danger"
          onClick={async ({ thread, message }: InteractionContext) => {
            await thread.update(
              message.ref,
              <Message accent="#EB5757">
                <Header>{`🚫 ${action}`}</Header>
                <Context>{"🛑 Declined. Nothing was sent."}</Context>
              </Message>,
            );
          }}
        >
          Reject
        </Button>
      </Actions>
    </Message>
  );
}
