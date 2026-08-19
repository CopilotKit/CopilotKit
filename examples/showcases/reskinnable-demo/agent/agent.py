"""Banking's offsite-expenses deep agent.

A LangChain deep agent with a SANDBOXED SHELL (its own container's filesystem via
`LocalShellBackend`) and PARALLEL SUBAGENTS for merchant research. It reads a
personal card statement, decides what the Austin offsite makes reimbursable,
files the reimbursable charges against the banking ledger over REST, and ends by
calling `submit_expense_report` — the tool banking's client renders as a React
report card.

Two constructor arguments are LOAD-BEARING and fail SILENTLY when missing:

  * `middleware=[CopilotKitMiddleware()]` — the only thing that binds tools
    forwarded from the browser. `ag_ui_langgraph` deposits `input.tools` into
    `state["ag-ui"]["tools"]` and binds NOTHING; the actual binding happens in
    `CopilotKitMiddleware.wrap_model_call`, which reads the runtime-context
    carrier that `LangGraphAGUIAgent` populates. Drop the middleware and the
    agent simply never calls a frontend tool — no error, no warning.
  * `backend=LocalShellBackend(...)` — without it deepagents defaults to a
    state-backed virtual filesystem, so the agent can write `analyze.py` and
    have nothing to execute it with.
"""

import os
import pathlib
import time

from deepagents import create_deep_agent
from deepagents.backends import LocalShellBackend
from langchain.agents.middleware import wrap_model_call
from langchain.tools import tool
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


EXPENSE_TASK_PROMPT = f"""

## LONG-RUNNING TASK — OFFSITE EXPENSE ANALYSIS

Everything above governs how you behave in general. This section is a SPECIFIC
JOB, and it applies ONLY when the user hands you a personal card statement and
asks which charges an offsite makes reimbursable. For every other request,
ignore this section entirely — it does not change your identity, your tools, or
the rules above.

When it DOES apply, you have a shell, a filesystem, and research subagents, and
you are expected to take minutes rather than answer in one turn.

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


def _thread_key(request) -> str:
    """Best-effort per-run key. Falls back to a constant, which degrades to the
    old single-run-at-a-time behaviour rather than crashing."""
    host = getattr(getattr(request, "runtime", None), "context", None)
    if isinstance(host, dict) and host.get("thread_id"):
        return str(host["thread_id"])
    state = request.state or {}
    return str(state.get("thread_id") or "default")


@wrap_model_call
async def _stamp_run_start(request, handler):
    """Record when this run's first model call happened.

    ASYNC on purpose. The AG-UI endpoint drives the graph with `astream`, and a
    sync-only `wrap_model_call` raises `NotImplementedError: Asynchronous
    implementation of awrap_model_call is not available` mid-run — which
    surfaces to the browser as a bare `RUN_ERROR: terminated` with the real
    cause visible only in this service's log.
    """
    key = _thread_key(request)
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


def _elapsed_seconds() -> int:
    """Longest-running clock still open, then clear it.

    The report tool has no access to the request, so it cannot name its own
    thread. Taking the OLDEST open stamp is right for the presenter constraint
    this demo already accepts elsewhere (one expense run at a time) and is a
    strict improvement on a single global: the thread-name generation call no
    longer decides when the clock started.
    """
    if not _RUN_STARTS:
        return 0
    key = min(_RUN_STARTS, key=lambda k: _RUN_STARTS[k])
    return int(time.time() - _RUN_STARTS.pop(key))


@tool
def submit_expense_report(verdicts: list[dict]) -> dict:
    """Submit the finished expense analysis. Renders as the user's report card.

    Call this exactly once, at the very end, after every filing call has been
    checked. The result is rendered directly to the user as a React report card,
    so do NOT restate the totals or the per-row verdicts in prose afterwards.

    Args:
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
        # `merchantKind` is a KIND ("hotel", "pharmacy"), and the report card
        # prints it inline beside the merchant name. A run that could not
        # establish one writes the literal string "unclear" into it, which
        # renders as `Cardinal & Ash unclear` — noise dressed as a finding. An
        # absent kind is the honest representation, and the widget already
        # handles it.
        if str(row.get("merchantKind", "")).strip().lower() in {
            "",
            "unclear",
            "unknown",
            "none",
        }:
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
        "elapsedSeconds": _elapsed_seconds(),
    }


def build_agent():
    """Build the offsite-expenses deep agent."""
    if not os.environ.get("OPENAI_API_KEY"):
        raise RuntimeError("Missing OPENAI_API_KEY environment variable")

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
        # The banking skin's own prompt FIRST — it establishes the identity, the
        # tool-routing rules, the formatting discipline and the teach-and-recall
        # arc that nine of this skin's ten demo beats depend on. The expense
        # section is appended as a conditional job, not a second identity.
        system_prompt=BANKING_PROMPT + EXPENSE_TASK_PROMPT,
        # `render_report` is banking's canvas report, ported from the TS
        # `defineTool`. The prompt's report-routing rules name it explicitly, so
        # without it registered here those rules describe a tool that is not
        # there.
        tools=[submit_expense_report, render_report],
        backend=backend,
        subagents=[
            {
                "name": "merchant-researcher",
                "description": (
                    "Establishes what kind of business ONE merchant is. "
                    "Dispatch one per merchant, all in the same response."
                ),
                "system_prompt": MERCHANT_RESEARCHER_PROMPT,
                # The subagent gets the search tool; the MAIN agent does not.
                # That split is the point of the fan-out: research is the slow,
                # parallelisable half, and keeping it off the main agent stops
                # it from quietly researching merchants serially in its own turn.
                "tools": [search_merchant],
            }
        ],
        # ORDER MATTERS. Middleware listed FIRST is OUTERMOST, so it sees the
        # request before later middleware has modified it. `_stamp_run_start`
        # goes LAST precisely so its tool log reflects the final bound set —
        # placed first it reports only this agent's own tools and reads as
        # "the host forwarded nothing", which is the exact wrong conclusion.
        middleware=[CopilotKitMiddleware(), _stamp_run_start],
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
    # 25 supersteps. The failure is brutal to read — the agent completes the
    # whole analysis, streams every argument of the final report, and only then
    # dies with `GraphRecursionError`, so the client sees a synthesized
    # `missing_terminal_event` result and the report card never renders.
    #
    # The recursion limit is set on the AGENT instead (`main.py`'s `config=`),
    # which is the path `ag_ui_langgraph` actually honours.
    return agent
