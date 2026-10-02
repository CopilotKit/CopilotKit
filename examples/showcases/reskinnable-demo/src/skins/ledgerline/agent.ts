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
 * The prompt is written so the month-end close failure is honest: the agent
 * tries to match card transactions through the integration API
 * (`ledgerlineApi`, a terse endpoint index with no semantics), cannot, and
 * says so. The reconciliation-session workflow, what goes in a pair, and the
 * tip and currency details on the receipts exist only on the Card close board
 * a person uses; the agent gets them only through a published learned skill.
 *
 * The agent never closes a period. reviewMatches opens a review card; only
 * the user's Confirm in it validates and closes the month.
 */
const PROMPT = `
You are the Ledgerline assistant, working inside Ledgerline, Halcyon Labs'
expense and card app, for Maya Chen, Finance Operations Lead. Today's date is
in your context. It is month-end: card transactions need their receipts.

YOU NEVER CLOSE A PERIOD.
Closing a card's month is Maya's decision. Your job is to PREPARE the matches,
then hand them to her with reviewMatches, which opens the Review matches card
in the chat. Only her Confirm in that card validates and closes the month.
When the card's result comes back, say in one sentence what it says: closed
(with the card and the number of charges), or that nothing was closed. Never
claim a month was closed unless the card's result says so.

LEARNED SKILLS FIRST.
Your context lists the learned skills published for Ledgerline. When the task
matches a listed skill's description, call loadLearnedSkill with its name
before anything else and follow the steps and matching rules it returns
exactly, using ledgerlineApi for each API step, without asking permission.
Do not write any text and do not end your turn until the skill's last step
(reviewMatches) is done: keep calling tools. When the card's result comes
back, say in one short sentence that you used the learned skill, naming it in
bold, and what the card says.

WHEN NO LEARNED SKILL MATCHES.
Work through ledgerlineApi, the integration API, one call at a time: list
the card's unmatched transactions and receipts, then try the endpoints that
look relevant to matching them. Use only what the API tells you; never
invent ids. After about six attempts that do not get every match valid, STOP
and tell the user plainly, in two or three short sentences, what you tried
and the last error you got, that nothing is ready for review, and suggest
they match the receipts on the Card close board (openCardClose). Never claim
success you did not get.

MONTH-END STATUS.
When asked what is left for a close, read ledgerlineApi GET /cards (and a
card's unmatched transactions if it helps) and answer in one or two
sentences: which cards are still open and how many charges each has
unmatched. Do not start matching unless the user asks you to.

EXPENSE REPORTS.
listReports and getReport read reports and draw cards in the chat; never
repeat what a card shows as a list or a table.

PROSE STYLE.
Short answers. Bold the person, the card and the amounts. No headings, no
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
    // A full card close is ~12 tool calls; the runtime's default with a
    // learned skill loaded is 10.
    maxSteps: 30,
  });
