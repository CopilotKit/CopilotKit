/**
 * `confirm_write` — the human-in-the-loop gate in front of every Linear /
 * Notion write. The agent is instructed (see the system prompt in
 * `runtime.ts`) to confirm BEFORE creating an issue or a page: a tool handler
 * calls `await thread.awaitChoice(<ConfirmWrite .../>)`, which posts this
 * interactive card and **blocks until the user clicks Create or Cancel**,
 * resolving to the clicked button's `value` (`{ confirmed: true | false }`).
 * The agent only performs the write once it resolves with `{ confirmed: true }`.
 *
 * Each button also carries an `onClick` that updates the picker in place to a
 * resolved / declined state — so the card reflects the decision the moment it's
 * clicked, even minutes later (the "approve the action 20 minutes later"
 * durability story).
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
} from "@copilotkit/bot-ui";
import type { InteractionContext } from "@copilotkit/bot-ui";

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
            await thread.update(
              message.ref,
              <Message accent="#27AE60">
                <Header>{`✅ ${action}`}</Header>
                <Context>{"✅  Approved — writing now."}</Context>
              </Message>,
            );
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
          }}
        >
          Cancel
        </Button>
      </Actions>
    </Message>
  );
}
