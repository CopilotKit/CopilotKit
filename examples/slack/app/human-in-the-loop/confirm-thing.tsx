/**
 * The picker for the LEGACY interrupt-based HITL path — the counterpart to
 * {@link ConfirmWrite}, and worth reading side by side with it because the two
 * models differ in where the waiting happens.
 *
 *   ConfirmWrite  (`thread.awaitChoice`)  — a channel-side TOOL HANDLER blocks;
 *                                           the agent run stays open; the
 *                                           waiter is an in-memory Map.
 *   ConfirmThing  (`onInterrupt`/`resume`) — the AGENT suspends in LangGraph's
 *                                           checkpointer; the run ENDS; the
 *                                           click starts a NEW run carrying
 *                                           `forwardedProps.command.resume`.
 *
 * Because the run ends, nothing is held open in memory between the post and the
 * click — which is what makes "approve it 20 minutes later" a property of this
 * path rather than a hope. The durability ceiling is set by two things: the
 * agent's checkpointer (`MemorySaver` in `agent-py/main.py` is process-local),
 * and registering this component on the channel so its handlers can be
 * re-fired after a restart instead of degrading to "action expired".
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

export interface ConfirmThingProps {
  /** One-line summary of the pending write, from the interrupt payload. */
  action: string;
  /** Optional specifics shown under the prompt. */
  detail?: string;
}

/**
 * `resume` sends the value the graph's `interrupt()` call returns. The shape is
 * a contract with `create_thing` in `agent-py/main.py`, which treats anything
 * other than `{approved: true}` as a decline.
 */
async function resumeWith(
  ctx: InteractionContext,
  approved: boolean,
  action: string,
): Promise<void> {
  // The channel side is where the decision is FIRST known. Log it here as well as
  // in the agent's `create_thing`, because the pair tells you which hop broke: a
  // CLICK line with no matching agent RESUMED line means the resume never landed.
  console.log(
    `[route-b] click → ${approved ? "APPROVED" : "DECLINED"} · ${action}`,
  );
  // Update the card FIRST so the click always produces visible feedback, even
  // if the resume itself fails — a silent card is the worst outcome here, since
  // the user has no other signal that their click registered.
  await ctx.thread.update(
    ctx.message.ref,
    approved ? (
      <Message accent="#27AE60">
        <Header>{`✅ ${action}`}</Header>
        <Context>{"✅  Approved — resuming the agent."}</Context>
      </Message>
    ) : (
      <Message accent="#EB5757">
        <Header>{`🚫 ${action}`}</Header>
        <Context>{"🚫  Declined — nothing was created."}</Context>
      </Message>
    ),
  );
  // Resumption requires the persisted one-use continuation behind this button;
  // it throws if the action expired (e.g. past `actionRetentionMs`). Surface
  // that in the thread rather than letting the click look successful.
  try {
    await ctx.thread.resume({ approved });
  } catch (err) {
    console.error("[route-b] resume failed:", err);
    await ctx.thread
      .post(
        "That approval could no longer be resumed — the agent run has expired. Please ask again.",
      )
      .catch((postErr: unknown) =>
        console.error("[route-b] failed to post resume error:", postErr),
      );
  }
}

export function ConfirmThing({ action, detail }: ConfirmThingProps) {
  return (
    <Message accent="#E2B340">
      <Header>{`🧪 ${action}?`}</Header>
      {detail ? <Section>{detail}</Section> : null}
      <Context>
        {
          "🔒  The agent is suspended until you choose (no-op probe — nothing is really written)."
        }
      </Context>
      <Actions>
        <Button
          value={{ approved: true }}
          style="primary"
          onClick={(ctx: InteractionContext) => resumeWith(ctx, true, action)}
        >
          Create
        </Button>
        <Button
          value={{ approved: false }}
          style="danger"
          onClick={(ctx: InteractionContext) => resumeWith(ctx, false, action)}
        >
          Cancel
        </Button>
      </Actions>
    </Message>
  );
}

/**
 * The picker as a plain value, so callers don't need JSX just to post it — which
 * is what keeps `route-b.ts` a `.ts` file and its `pnpm tsx app/route-b.ts`
 * command working. The element still names `ConfirmThing`, so registering the
 * component via `components: [ConfirmThing]` keeps clicks durable exactly as if
 * the JSX were written inline at the call site.
 */
export function confirmThingCard(props: ConfirmThingProps) {
  return <ConfirmThing {...props} />;
}
