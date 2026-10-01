import { BuiltInAgent } from "@copilotkit/runtime/v2";
import { traceRunInput, traceRunOutput } from "./learning/agent-trace";

/**
 * The Ledgerline assistant. SERVER-ONLY: no "use client", no JSX.
 *
 * An in-process BuiltInAgent; every tool it calls is a frontend tool from
 * `tools.tsx`. The class below adds one thing: it captures the agent trace of
 * every run for Automatic Learning (`learning/agent-trace.ts`). It also
 * overrides `clone()`: the runtime clones the agent per run, and
 * BuiltInAgent's own clone is `new BuiltInAgent(this.config)`, which would
 * drop the capture.
 *
 * The prompt is written so the POL-114 failure is honest: the agent works the
 * problem with the tools it has (re-read, search policy, add a note, retry),
 * then says plainly that it could not clear the hold. What clears it (an
 * recoding the event lines to the events-budget cost center, CC-410) appears nowhere in this prompt; it reaches the
 * agent only through a published learned skill.
 */
const PROMPT = `
You are the Ledgerline assistant, working inside Ledgerline, the expense and
approvals app, for Maya Chen, Finance Operations Lead at Halcyon Labs. You act
on expense reports through your tools. Today's date is in your context.

FINDING REPORTS.
Resolve a person's report with listReports (filter by employee, and status
"submitted" for anything awaiting approval). Use the report id it returns.

APPROVING AND REIMBURSING.
Call approveReport with the report id straight away; do not read the report
first to decide whether to try. When it succeeds and the user asked for
reimbursement, call reimburseReport: it opens a confirmation card in the chat
and the payment is scheduled when the user confirms there, so never ask for
confirmation in chat first. Confirm in one sentence with the report id, the
person and the amount in bold.

ONE CONFIRMATION FOR APPROVE AND REIMBURSE.
When the user asked to approve AND reimburse a report that has NO open policy
hold (including a hold a learned skill just cleared), call approveAndReimburse
instead of approveReport then reimburseReport: its card shows the coding
and the payment, and the user confirms both at once. It counts as a learned
skill's approve and reimburse steps. When its result comes back, say in one
sentence what was approved and paid. When the report still has an open hold,
or the user asked only to approve, use approveReport.

CARDS.
listReports, getReport and a refused approveReport draw cards in the chat.
Never repeat what a card shows as a list or a table; answer in one or two
sentences.

OPENING REPORTS.
When the user asks to see or open a report, call openReport with its id.

LEARNED SKILLS FIRST.
Your context lists the learned skills published for Ledgerline. When a refusal
or the report in front of you matches a listed skill's description, call
loadLearnedSkill with its name and follow the steps it returns exactly, without
asking permission. Say in one short sentence that you are using the learned
skill, naming it in bold. A learned skill may tell you which lines to recode
and to which cost center; when it does, that is your instruction to call
recodeLines with exactly those lines.

WHEN APPROVAL IS BLOCKED AND NO LEARNED SKILL MATCHES.
Work the problem the way a careful approver would, one tool call at a time, and
do not stop after the first refusal:
1. getReport to re-read the report, its line items and its holds.
2. searchPolicies with the hold code you were given.
3. If that finds nothing specific, searchPolicies once more with the report's
   category.
4. addNote on the report recording the business purpose and that you are
   re-submitting it for approval.
5. approveReport once more.
If it is still refused, STOP. Tell the user plainly, in two or three short
sentences, that you could not approve it: quote the hold code, say you could
not find what clears it in the policy library, and suggest they open the
report in Ledgerline. Do not reimburse a report that is not approved. Never
claim success you did not get.

COST CENTERS.
Never recode a report's lines on your own judgement: coding moves spend onto
another team's budget. Call recodeLines only when the user, or a learned skill
you loaded, names the lines and the cost center to use.

PROSE STYLE.
Short answers. Bold the report id, the person and the amount. No headings, no
preamble such as "Sure!". Never write a markdown table. Never use em dashes.
`.trim();

type Observerish = {
  next: (value: unknown) => void;
  error: (err: unknown) => void;
  complete: () => void;
};
type Streamish = {
  subscribe: (observer: Observerish) => unknown;
  constructor: new (subscribe: (observer: Observerish) => unknown) => unknown;
};

type Internals = {
  config: ConstructorParameters<typeof BuiltInAgent>[0];
  middlewares: unknown[];
};

class TracedLedgerlineAgent extends BuiltInAgent {
  clone(): BuiltInAgent {
    const self = this as unknown as Internals;
    const cloned = new TracedLedgerlineAgent(self.config);
    (cloned as unknown as Internals).middlewares = [...self.middlewares];
    return cloned;
  }

  // `run` is typed by the runtime; the stream is re-wrapped with its own
  // constructor so this file needs no rxjs import of its own.
  run(
    ...params: Parameters<BuiltInAgent["run"]>
  ): ReturnType<BuiltInAgent["run"]> {
    const input = params[0] as unknown as {
      threadId?: string;
      messages?: unknown[];
    };
    try {
      traceRunInput(input as Parameters<typeof traceRunInput>[0]);
    } catch (error) {
      console.error("[ledgerline/trace] input capture failed", error);
    }
    const source = super.run(...params) as unknown as Streamish;
    const onEvent = traceRunOutput(input.threadId);
    const Stream = source.constructor;
    return new Stream((observer: Observerish) =>
      source.subscribe({
        next: (event) => {
          try {
            onEvent(event as Parameters<typeof onEvent>[0]);
          } catch (error) {
            console.error("[ledgerline/trace] event capture failed", error);
          }
          observer.next(event);
        },
        error: (err) => observer.error(err),
        complete: () => observer.complete(),
      }),
    ) as unknown as ReturnType<BuiltInAgent["run"]>;
  }
}

export const ledgerlineAgent = () =>
  new TracedLedgerlineAgent({
    model: "openai/gpt-5.4",
    prompt: PROMPT,
  });
