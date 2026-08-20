"""Banking's agent: a LangChain deep agent, in three nested levels.

    banking                       gpt-5.4, temp 0
      │  banking's own prompt; the browser's frontend tools and the
      │  Intelligence memory tools; `render_report` for the canvas
      └─ expense-analyst          gpt-5.6-sol, reasoning_effort=high
           │  sandboxed shell (LocalShellBackend), `submit_expense_report`
           └─ merchant-researcher gpt-5.4, streaming OFF, one per merchant
                `search_merchant` (Tavily)

The nesting is the design, not an accident of growth. Each level exists because
something about it must differ from its parent — prompt, model, tool set, or
whether it streams — and a single agent had nowhere to put any of that.

Three constructor arguments are LOAD-BEARING and fail SILENTLY when missing:

  * `middleware=[CopilotKitMiddleware()]` on the TOP level — the only thing that
    binds tools forwarded from the browser. `ag_ui_langgraph` deposits
    `input.tools` into `state["ag-ui"]["tools"]` and binds NOTHING; the actual
    binding happens in `CopilotKitMiddleware.wrap_model_call`, which reads the
    runtime-context carrier that `LangGraphAGUIAgent` populates. Drop it and the
    agent simply never calls a frontend tool — no error, no warning.
  * `backend=LocalShellBackend(...)` on the ANALYST — without it deepagents
    defaults to a state-backed virtual filesystem, so the agent can write
    `analyze.py` and have nothing to execute it with.
  * `emit_subagent_events=True` on the AG-UI agent (`main.py`) — without it the
    stream carries no `subagentRunId`, so the console cannot tell the harness's
    work from the parent's and a reopened thread collapses the whole run to one
    tool message. It also carries the per-lane state that stops ten concurrent
    researchers interleaving their prose (which is why the researcher's model no
    longer needs `disable_streaming`).

Nested tool calls DO reach the browser: a probe confirmed the analyst's `task`
dispatches, the researchers' `search_merchant` calls and the final report tool
all appear in `astream_events`, which is what `ag_ui_langgraph` builds AG-UI
events from. That is what lets one CLI console in the transcript draw the whole
journey regardless of which level produced a line.
"""

import os
import pathlib
import time

from deepagents import create_deep_agent
from deepagents.backends import LocalShellBackend
from langchain.agents.middleware import wrap_model_call
from langchain.tools import tool, ToolRuntime
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver

from copilotkit import CopilotKitMiddleware

from prompt import BANKING_PROMPT
from report import render_report

# The offsite the agent reasons against. Mirrors `harness/types.ts`'s OFFSITE —
# the two must agree, and the invariant guard in the demo's test suite is what
# pins the CSV fixture to these dates.
OFFSITE_CITY = "Austin"
OFFSITE_START = "2026-07-14"
OFFSITE_END = "2026-07-16"


def _app_base_url() -> str:
    """Where the Next app answers, as this SERVICE sees it.

    From inside the compose network that is the app's service name; from a bare
    `pnpm dev` it is localhost. One variable so the CSV read and the ledger POST
    baked into the prompt below cannot disagree — a wrong port here files every
    charge into a dead socket, and the run still "succeeds" with every
    `filedTransactionId` missing.
    """
    return os.environ.get("DEMO_APP_URL", "http://localhost:3000")


EXPENSE_ANALYST_PROMPT = f"""You are an expense analyst with a shell, a
filesystem, and research subagents. You have been handed one job and you are
expected to take minutes over it rather than answer in a single turn.

This is your ENTIRE brief. You are not the banking copilot and you do not answer
anything else — a parent agent delegated this task to you and will relay your
result.

CONTEXT: there was a company offsite in {OFFSITE_CITY} from {OFFSITE_START} to
{OFFSITE_END}. Expenses are reimbursable only when they are business expenses
connected to that offsite: travel to and from it, lodging during it, ground
transport during it, and meals during it. Personal consumption, subscriptions,
and anything outside those dates or unrelated to the trip are NOT reimbursable.

DO THIS, IN THIS ORDER:

1. Fetch the statement into your working directory:

   curl -sS -o expenses.csv {_app_base_url()}/sample-expenses-offsite.csv

   Then check it is really a CSV — `head -3 expenses.csv`. If it came back as an
   HTML error page, STOP and say so. Analysing a 404 page as if it were the
   statement wastes minutes and produces a confident, wrong answer.

2. Write a short python script to parse and group the rows and RUN it with
   python3. Do not eyeball the rows by hand.

3. For every merchant whose nature you cannot determine from its name alone,
   delegate to the `merchant-researcher` subagent to find out what kind of
   business it is. "Cardinal & Ash" could be a restaurant or a law firm; find
   out rather than assume.

   DISPATCH ALL OF THEM IN ONE RESPONSE — emit one task call per merchant in the
   same assistant turn so they run concurrently. Do not wait for one to come
   back before starting the next.

4. Decide each row: "expensable", "personal", or "unclear" when even after
   researching you cannot responsibly decide. Give a one-sentence reason citing
   the offsite dates or what the research established.

5. File every "expensable" row against the company ledger. The endpoint takes
   exactly the three fields `merchant`, `amount` and `note`, nothing else, and
   answers 201 with the new transaction's id:

   curl -sS -X POST {_app_base_url()}/api/banking/v1/transactions \\
     -H 'content-type: application/json' \\
     -w '%{{http_code}}' \\
     -d '{{"merchant":"Hotel Verrano","amount":318.55,"note":"Offsite {OFFSITE_CITY} — reimbursable"}}'

   CHECK EVERY SINGLE CALL BEFORE MOVING ON. If a call does not come back 201
   with an `id`, then for that row you must:
     - NOT invent, guess, pattern-match, or reuse a transaction id;
     - leave `filedTransactionId` absent from that row entirely;
     - state in that row's `reason` that the filing failed, with the status code.
   A made-up id is far worse than a failed filing: it tells the reader money
   moved when it did not. Never write an id you did not read out of a 201 body.

6. Call `submit_expense_report` with one verdict per CSV row, in the order the
   rows appear. THIS IS THE DELIVERABLE — if you do not call it, all of your
   work is discarded. Each row's `amount` must be the amount from the CSV,
   copied exactly. Do not compute any totals: the tool derives them from the
   verdicts you pass.

Work carefully and take the time you need. Narrate what you are doing as you go.
"""

MERCHANT_RESEARCHER_PROMPT = """You establish what kind of business a single
merchant is.

Call `search_merchant` with the merchant name. Base your answer on what it
returns — you are here BECAUSE the name alone was not enough, so answering from
what the name sounds like defeats the point.

Reply with one short line: the kind of business (e.g. "hotel", "streaming
service", "steakhouse in Austin") and what the search established. If the search
comes back empty or contradictory, say you could not establish it — an honest
"unknown" is worth more than a confident guess, because a wrong merchant kind
becomes a wrongly reimbursed charge."""


@tool
def search_merchant(query: str) -> list[dict]:
    """Search the web to find out what kind of business a merchant is.

    Args:
        query: What to search for — usually the merchant name, optionally with a
            city (e.g. "Cardinal & Ash Austin").

    Returns:
        A list of {url, title, content} results.
    """
    api_key = os.environ.get("TAVILY_API_KEY")
    if not api_key:
        # LOUD TO THE MODEL, not fatal to the run.
        #
        # This RAISED at first, on the reasoning that a run which never searched
        # must not quietly claim it did. Raising was the wrong instrument: a
        # tool exception propagates out of the subagent and terminates the whole
        # graph task, so a missing key stopped killing the merchant lookup and
        # started killing the entire multi-minute beat — measured, after the
        # agent had already read the CSV and dispatched its research.
        #
        # Returning the message keeps the honesty (the subagent is told plainly
        # that no search happened, and the prompt tells it to report "could not
        # establish" rather than guess) while letting the run finish with
        # unclear rows — which is the correct degraded answer, not a crash.
        return [
            {
                "url": "",
                "title": "search unavailable",
                "content": (
                    "TAVILY_API_KEY is not set, so no web search was performed. "
                    "Report that you could not establish this merchant. Do not "
                    "guess from the name."
                ),
            }
        ]

    from tavily import TavilyClient

    results = TavilyClient(api_key=api_key).search(
        query=query,
        max_results=5,
        include_raw_content=False,
        topic="general",
    )
    return [
        {
            "url": r.get("url", ""),
            "title": r.get("title", ""),
            # Truncated: five untrimmed pages per merchant across seven
            # concurrent subagents is a lot of context for "is this a hotel".
            "content": (r.get("content") or "")[:2000],
        }
        for r in results.get("results", [])
    ]


# --- run clock ---------------------------------------------------------------
# `HarnessSummary.elapsedSeconds` is the report card's "this took minutes" proof,
# so it has to be measured rather than estimated by the model.
#
# KEYED BY THREAD, not a module global. A single global looks sufficient — one
# concurrent expense run per demo instance is a correct constraint for a
# presenter demo — and it is wrong for a reason that is invisible until you look
# at the wire: against the Intelligence runtime a run is TWO calls into this
# service, and the first is thread-name generation (no tools, two messages)
# rather than the user's actual run. A global gets stamped by the namer, so the
# clock starts before the work does and a `first call only` log reports the
# namer's empty tool list and then goes quiet for the run that matters.
_RUN_STARTS: dict[str, float] = {}


def _run_key_from_config(config) -> str:
    """The thread this call belongs to, read from a LangChain `RunnableConfig`.

    ONE derivation used by both writers and the reader, so the middleware that
    starts the clock and the tool that stops it cannot disagree about which run
    they are talking about. Guessing was the old bug: the reader could not name
    its own thread, so it took the oldest open stamp and inherited a previous
    run's.
    """
    cfg = config or {}
    configurable = cfg.get("configurable") if isinstance(cfg, dict) else None
    if isinstance(configurable, dict) and configurable.get("thread_id"):
        return str(configurable["thread_id"])
    return "default"


def _run_key_from_request(request) -> str:
    """Same key, from a middleware `ModelRequest`."""
    host = getattr(getattr(request, "runtime", None), "context", None)
    if isinstance(host, dict) and host.get("thread_id"):
        return str(host["thread_id"])
    cfg = getattr(getattr(request, "runtime", None), "config", None)
    return _run_key_from_config(cfg)


@wrap_model_call
async def _stamp_run_start(request, handler):
    """Record when this run's first model call happened.

    ASYNC on purpose. The AG-UI endpoint drives the graph with `astream`, and a
    sync-only `wrap_model_call` raises `NotImplementedError: Asynchronous
    implementation of awrap_model_call is not available` mid-run — which
    surfaces to the browser as a bare `RUN_ERROR: terminated` with the real
    cause visible only in this service's log.
    """
    # Start the clock at the FIRST model call of this thread's run, and never
    # re-stamp it. The `not in` guard is what makes the twentieth model call of
    # a long run leave the start time alone.
    key = _run_key_from_request(request)
    if key not in _RUN_STARTS:
        _RUN_STARTS[key] = time.time()

    # An ALARM, not a trace.
    #
    # This integration's nastiest silent failure is host tools never reaching
    # the model: the browser's frontend tools and the Intelligence MCP tools
    # (`recall_memory`, `save_memory`, `forget_memory`) are bound ONLY because
    # `CopilotKitMiddleware` is in the middleware list below. Drop it and
    # everything still boots, still streams, still answers — the agent simply
    # never calls a host tool, with no error anywhere.
    #
    # So compare the two numbers rather than printing either: the host said it
    # forwarded N, and the model was handed a set that should contain all N. If
    # it does not, the bridge is broken and this says so on the spot. A plain
    # per-call trace does not — a healthy run and a broken one both just print a
    # list of names, and telling them apart means knowing which call you are
    # looking at. That is exactly the mistake this line exists to prevent.
    bound = {
        getattr(t, "name", None) or (t.get("name") if isinstance(t, dict) else None)
        for t in request.tools or []
    }
    host = getattr(getattr(request, "runtime", None), "context", None)
    forwarded = {
        t.get("name")
        for t in (
            (host.get("copilotkit") or {}).get("actions") or []
            if isinstance(host, dict)
            else []
        )
        if isinstance(t, dict)
    }
    missing = {n for n in (forwarded - bound) if n}
    if missing:
        print(
            f"[expense-agent] WARNING: the host forwarded {sorted(missing)} but "
            f"the model was not given them. Is CopilotKitMiddleware still in "
            f"the middleware list?"
        )
    return await handler(request)


def _elapsed_seconds(key: str) -> int:
    """Seconds since this THREAD's run started, then release the stamp.

    Keyed, because the previous version was not and reported nonsense: it took
    the oldest stamp still open across every thread the process had seen.
    Trailing model calls AFTER the report re-stamp the clock, so that leftover
    became the next run's start time — measured, a two-minute run reported 333s.
    A duration is printed on the report card as a fact next to totals that
    reconcile, so a plausible wrong number is the worst kind.

    A missing stamp returns 0 rather than a guess: no start time means we do not
    know how long it took, and inventing one here would be the same defect in a
    smaller font.
    """
    started = _RUN_STARTS.pop(key, None)
    return 0 if started is None else int(time.time() - started)


@tool
def submit_expense_report(verdicts: list[dict], runtime: ToolRuntime) -> dict:
    """Submit the finished expense analysis. Renders as the user's report card.

    Call this exactly once, at the very end, after every filing call has been
    checked. The result is rendered directly to the user as a React report card,
    so do NOT restate the totals or the per-row verdicts in prose afterwards.

    Args:
        runtime: Injected by LangChain — NOT a parameter the model supplies, and
            not part of the tool schema it sees. It carries this call's config,
            which is how the tool names its own run to stop the clock.
        verdicts: One entry per CSV row, in the order the rows appear. Each is
            {merchant, date, amount, decision, reason} plus the optional
            merchantKind and filedTransactionId. `decision` is one of
            "expensable", "personal" or "unclear". Omit the optional keys rather
            than writing a placeholder — an absent filedTransactionId is how the
            report card knows a filing did not land.
    """
    # THE TOTALS ARE DERIVED HERE, AND ARE DELIBERATELY NOT PARAMETERS.
    #
    # They used to be arguments, with the prompt spelling out that they were
    # sums of dollar amounts rather than row counts. A measured run still got
    # them wrong: every per-row amount matched the CSV exactly, while the
    # headline totals came back $1.00 and $0.20 high — the model authored them
    # instead of adding them, having had a shell and a script available the
    # whole time.
    #
    # That is the one error this beat cannot survive. The report card prints the
    # total in a large tile directly above the rows it is supposedly the sum of,
    # so a buyer looking at a BANKING demo sees a finance product that cannot
    # add up. Prompt wording cannot fix it, because the failure is the model
    # being asked for a number it should never have been asked for. Deriving
    # them from `verdicts` makes tiles and rows unable to disagree.
    # `amount` ARRIVES AS A STRING. Measured: all fourteen rows of a real run
    # came back as `"842.10"` rather than `842.10`, because a tool argument
    # typed `list[dict]` carries no per-key schema for the model to satisfy.
    # TypeScript's `ExpenseVerdict.amount` is `number`, and the report card
    # formats it with `toLocaleString("en-US", {style: "currency"})` — which on
    # a string silently ignores the options and prints a bare `842.10` with no
    # currency at all. Coercing at this boundary is what keeps the widget's
    # declared type honest.
    clean: list[dict] = []
    for v in verdicts:
        row = dict(v)
        try:
            row["amount"] = round(float(row.get("amount", 0) or 0), 2)
        except (TypeError, ValueError):
            row["amount"] = 0.0
        # `merchantKind` is a KIND — "hotel", "pharmacy" — and the report card
        # prints it inline beside the merchant name, where it has room for about
        # two words. A run that could not establish one must leave it ABSENT;
        # the widget already handles that, and an absent kind is the honest
        # representation of "we looked and could not tell".
        #
        # Matching exact strings was not enough. With no search tool the model
        # wrote a bare "unclear"; with a real one it hedges in prose instead —
        # measured: "unknown (likely wellness-related business)" and "unknown
        # (likely bookbindery/bookshop retail, but not established for this
        # exact merchant)". Both start with a non-answer and neither is a kind,
        # but an exact-match filter passes them straight through into a 60-char
        # label glued to the merchant name.
        #
        # So: reject on the leading token, reject on hedging language anywhere,
        # and reject anything too long to be a kind. Length is the backstop that
        # catches the next phrasing nobody predicted.
        kind = str(row.get("merchantKind", "")).strip()
        lowered = kind.lower()
        non_answer = (
            not kind
            or lowered.startswith(("unknown", "unclear", "none", "n/a", "not "))
            or "not established" in lowered
            or "could not" in lowered
            or len(kind) > 40
        )
        if non_answer:
            row.pop("merchantKind", None)
        clean.append(row)

    expensable = sum(v["amount"] for v in clean if v.get("decision") == "expensable")
    personal = sum(v["amount"] for v in clean if v.get("decision") == "personal")
    # Rows marked "unclear" belong to NEITHER total — they are the rows a human
    # still has to look at, and folding them into either one hides that.

    # Merchants RESEARCHED, which is not the same as merchants seen: the tile is
    # labelled "merchants researched" and the statement repeats merchants
    # (Hotel Verrano is two nights). Counting distinct names instead reported 13
    # of 14 rows as researched on a run that dispatched seven subagents. A
    # surviving `merchantKind` is the evidence that research actually landed.
    researched = len({v["merchant"] for v in clean if v.get("merchantKind")})

    # Echoed back so the value reaches the client as the tool RESULT. The client
    # renders off the result rather than the streamed args, which is what makes
    # a half-streamed report impossible to show as a finished one.
    return {
        "rowsRead": len(clean),
        "merchantsSearched": researched,
        "totalExpensable": round(expensable, 2),
        "totalPersonal": round(personal, 2),
        "verdicts": clean,
        # Measured, never asked of the model — a model-estimated duration is
        # exactly the kind of number that reads as a fact on stage.
        "elapsedSeconds": _elapsed_seconds(_run_key_from_config(runtime.config)),
    }


DELEGATION_PROMPT = """

## DELEGATING THE OFFSITE EXPENSE ANALYSIS

When the user hands you a personal card statement and asks which charges an
offsite makes reimbursable, do NOT attempt it yourself. Delegate the ENTIRE job
to the `expense-analyst` subagent with one task call, passing along what the user
told you.

That subagent has a shell, research subagents of its own, and the authority to
file charges against the ledger. It will take minutes and it reports its own
findings to the user directly. When it returns, say ONE short sentence
acknowledging it finished — the report card it produced is already on screen, so
do not restate its totals, its verdicts, or its per-row reasoning.
"""


def _build_expense_analyst():
    """The offsite-expenses agent: a deep agent in its own right.

    A SEPARATE agent rather than a section of banking's prompt, and that is the
    load-bearing part of this design.

    Banking's own prompt is ~21,000 characters of rules about markdown tables,
    PIN handling, memory scoping and gen-UI restraint. The expense run makes on
    the order of twenty model calls. Folded into one agent, every one of those
    calls re-sends the entire banking rulebook while the agent is reading a CSV —
    paid in latency and tokens, on every superstep, for rules that cannot apply.

    Splitting it also gives the beat somewhere for its own configuration to
    live. It runs on a stronger model at high reasoning effort (the policy
    judgement is the hard part and deserves it), while the six other banking
    beats stay on the cheaper model. With one agent there was no such seam:
    model, effort and recursion limit were all agent-level, and there was only
    one agent.

    Reached as a `CompiledSubAgent`, because a raw `SubAgent` spec has no
    `subagents` field and this agent needs its own — the per-merchant fan-out is
    a headline of the beat, and a flat subagent could only research serially.
    Verified that nesting survives: a probe run showed the analyst's `task`
    dispatches, the researchers' `search` calls and the final report tool ALL
    reaching `astream_events`, which is what `ag_ui_langgraph` builds AG-UI
    events from. So the console still draws the whole journey.
    """
    workspace = pathlib.Path(os.environ.get("AGENT_WORKSPACE", "/tmp/expense-agent"))
    workspace.mkdir(parents=True, exist_ok=True)

    # The sandbox. `virtual_mode=False` so the agent's shell sees real paths it
    # can hand to python3; `root_dir` keeps it in a scratch directory rather than
    # the service's own source tree.
    backend = LocalShellBackend(
        root_dir=str(workspace),
        virtual_mode=False,
        timeout=180,
    )

    analyst_model = ChatOpenAI(
        model=os.environ.get("BANKING_EXPENSE_MODEL", "gpt-5.6-sol"),
        # High effort is not padding. The judgement calls here are the genuinely
        # hard part — whether a resolved merchant kind makes a charge
        # reimbursable under the offsite's dates — and it is also the honest way
        # to make a run take minutes: it thinks longer because there is more
        # thinking to do, rather than waiting on a timer.
        reasoning_effort=os.environ.get("BANKING_EXPENSE_EFFORT", "high"),
        # REQUIRED with the two settings above, and the failure is a hard 400 on
        # the first model call inside the analyst:
        #
        #   Function tools with reasoning_effort are not supported for
        #   gpt-5.6-sol in /v1/chat/completions. To use function tools, use
        #   /v1/responses or set reasoning_effort to 'none'.
        #
        # This agent is nothing but function tools — shell, filesystem, task
        # dispatch, the report — so 'none' is not an option and the Responses
        # API is the only way to keep the reasoning effort.
        #
        # Worth knowing how this was missed: the first probe asked the model a
        # plain question with NO tools bound, and passed. Binding a tool is what
        # surfaces the constraint, so a model probe for an AGENT has to bind one.
        use_responses_api=True,
    )

    # The researchers get their OWN model with streaming switched off.
    #
    # Up to ten of them run at once, and a streaming model makes each one emit
    # TEXT_MESSAGE_CONTENT deltas into the same AG-UI message stream. The
    # transcript then shows all ten prose answers shredded together
    # token-by-token — measured, and it is not subtly wrong, it is unreadable:
    #
    #   "Northgate Pharmacy | likely business type: pharmacy | plausibly
    #    restaurant/bar/hotel/transport/subscription/pharmacy/wellQuill &
    #    Bindery -ness/ret bookstoreail/bookbindery retail; ..."
    #
    # Nothing is lost by silencing them. A subagent's answer reaches its parent
    # as the `task` tool's RESULT, a single complete message rather than a delta
    # stream, so the console still prints each dispatch and each finding
    # attributable to the merchant it belongs to.
    #
    # They also stay on the CHEAPER model: they summarise search results, they
    # do not make policy judgements, and high effort times ten concurrent calls
    # is real money for no gain.
    research_model = ChatOpenAI(
        model=os.environ.get("BANKING_AGENT_MODEL", "gpt-5.4"),
        temperature=0,
        # `disable_streaming=True` USED to be here, and is deliberately gone.
        #
        # It was a workaround for ten concurrent researchers shredding their
        # prose into one interleaved message — real and unreadable, but a symptom
        # of the protocol having no way to say which subagent a token belonged
        # to. `emit_subagent_events` (see `main.py`) fixes it at the source with
        # per-lane state, so the researchers can stream again and the console
        # gets narration attributable to the merchant it is about.
        #
        # If interleaving ever comes back, check that the flag survived the
        # per-request `clone()` before reaching for this again — a dropped flag
        # looks exactly like the old bug.
    )

    return create_deep_agent(
        model=analyst_model,
        system_prompt=EXPENSE_ANALYST_PROMPT,
        tools=[submit_expense_report],
        backend=backend,
        subagents=[
            {
                "name": "merchant-researcher",
                "description": (
                    "Establishes what kind of business ONE merchant is. "
                    "Dispatch one per merchant, all in the same response."
                ),
                "system_prompt": MERCHANT_RESEARCHER_PROMPT,
                "model": research_model,
                # The subagent gets the search tool; the ANALYST does not. That
                # split is the point of the fan-out: research is the slow,
                # parallelisable half, and keeping it off the analyst stops it
                # from quietly researching merchants serially in its own turn.
                "tools": [search_merchant],
            }
        ],
        # The run clock lives HERE, not on the parent: this is the agent whose
        # elapsed time the report card reports.
        middleware=[_stamp_run_start],
        checkpointer=MemorySaver(),
    )


def build_agent():
    """Build banking's agent."""
    if not os.environ.get("OPENAI_API_KEY"):
        raise RuntimeError("Missing OPENAI_API_KEY environment variable")

    model = ChatOpenAI(
        # Both values are carried over from the TypeScript `BuiltInAgent` this
        # replaces, where each had a reason written beside it:
        #   - the NON-mini model, because the multi-step teach-and-recall arc
        #     (recall -> offer to record -> watch -> save) routes unreliably on
        #     the mini model;
        #   - temperature 0, because tool ROUTING must be deterministic. This
        #     agent's job is picking the right tool far more often than it is
        #     composing prose.
        model=os.environ.get("BANKING_AGENT_MODEL", "gpt-5.4"),
        temperature=0,
    )

    agent = create_deep_agent(
        model=model,
        # Banking's own prompt, plus how to hand off the expense job. The expense
        # TASK spec is not here any more — it belongs to the analyst.
        system_prompt=BANKING_PROMPT + DELEGATION_PROMPT,
        # `render_report` is banking's canvas report, ported from the TS
        # `defineTool`. The prompt's report-routing rules name it explicitly, so
        # without it registered here those rules describe a tool that is not
        # there.
        tools=[render_report],
        subagents=[
            {
                "name": "expense-analyst",
                "description": (
                    "Analyses a personal card statement against a company "
                    "offsite: researches every merchant, decides what is "
                    "reimbursable, files the reimbursable charges against the "
                    "ledger and produces the report card. Takes minutes. "
                    "Delegate the WHOLE job in one call."
                ),
                "runnable": _build_expense_analyst(),
            }
        ],
        # `CopilotKitMiddleware` binds the tools the HOST forwards — the
        # browser's frontend tools and the Intelligence memory tools. It belongs
        # on this agent only: the analyst has no business calling
        # `showTransactions` or writing durable memories, and leaving it off
        # keeps its context to the job.
        middleware=[CopilotKitMiddleware()],
        # REQUIRED, not optional: `ag_ui_langgraph` calls `graph.aget_state()`
        # on every run to diff agent state for the AG-UI stream, and LangGraph
        # raises `ValueError: No checkpointer set` without one. The failure is a
        # 500 on the very first message, so this is load-bearing for the demo
        # rather than a durability nicety.
        checkpointer=MemorySaver(),
    )

    # Returned RAW, deliberately. `agent.with_config({"recursion_limit": N})` is
    # the obvious-looking way to raise the limit and it DOES NOT WORK here: the
    # AG-UI adapter builds its own RunnableConfig for `astream_events`, so the
    # binding's config is dropped and the graph runs at LangGraph's default of
    # 25 supersteps. The failure is brutal to read - the agent completes the
    # whole analysis, streams every argument of the final report, and only then
    # dies with `GraphRecursionError`, so the client sees a synthesized
    # `missing_terminal_event` result and the report card never renders.
    #
    # The recursion limit is set on the AGENT instead (`main.py`'s `config=`),
    # which is the path `ag_ui_langgraph` actually honours.
    return agent
