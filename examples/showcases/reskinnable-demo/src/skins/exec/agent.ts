import { z } from "zod";
import { BuiltInAgent, defineTool } from "@copilotkit/runtime/v2";
import * as store from "@/skins/exec/data/store";
import {
  isBreach,
  variancePct,
  varianceVsForecast,
} from "@/skins/exec/data/derive";
import {
  A2UI_OPERATIONS_KEY,
  buildBlockOps,
} from "@/skins/exec/blocks/build-block-ops";
import type { NarrativeCode } from "@/skins/exec/data/types";

// SERVER-SAFE. No client directive, no JSX, no React. Imported only by the
// server agent registry (src/shell/agent-registry.ts), never by the client skin
// module — it pulls in @copilotkit/runtime, which must never reach the browser
// bundle. Keyed by the same id as the skin: "exec".
//
// Zod schemas cannot import TS types at runtime, so the enums below mirror the
// literal unions in `./data/types.ts` by hand — keep them in sync, exactly as
// `./catalog/definitions.ts` does for the same unions.
//
// ⚠️ ONE UNION IS DELIBERATELY ABSENT: `NarrativeCode`. See
// `fileVarianceNarrativeTool` for why the four variance codes are never spelled
// in any schema, description or prompt line in this file.

const metricId = z.enum([
  "revenue",
  "growthQoQ",
  "growthYoY",
  "operatingMargin",
  "ebitda",
  "cash",
  "runwayMonths",
  "nps",
  "burnRate",
  "arAgingDays",
  "dsoDays",
  "opex",
  "headcountCost",
  "forecastAccuracy",
]);

const department = z.enum([
  "manufacturing",
  "distribution",
  "field-services",
  "corporate",
  "all",
]);

/**
 * Backend tool: the agent's data sense. Returns the raw monthly series AND the
 * variance rows derived from it via `./data/derive` — the same functions the
 * client catalog renderers use, so a figure the agent says out loud and a
 * figure a block draws can never disagree.
 *
 * Variance is returned rather than left to the model: an LLM subtracting and
 * dividing fourteen metrics' worth of plan/actual pairs is the one arithmetic
 * this demo cannot afford to get wrong on stage.
 */
export const getMetricsTool = defineTool({
  name: "get_metrics",
  description:
    "Read one metric's monthly plan/actual/forecast series, with the variance " +
    "already computed for each period. Call this BEFORE stating any figure — " +
    "you do not know Cascade's numbers from memory. Optionally scope to one " +
    "department (only 'opex' and 'headcountCost' have per-department series; " +
    "pass 'all' for the company-wide series) and to the last N months.",
  parameters: z.object({
    metricId: metricId.describe("Which metric to read."),
    department: department
      .optional()
      .describe(
        "Omit to get every series for the metric; pass 'all' for the " +
          "company-wide one.",
      ),
    months: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Trailing window, in months. Omit for the full history."),
  }),
  execute: async ({ metricId: id, department: dept, months }) => {
    const def = store.snapshot().metricDefs.find((d) => d.id === id);
    const rows = store.metricSeries({ metricId: id, department: dept, months });
    return {
      metricId: id,
      label: def?.label,
      unit: def?.unit,
      // The threshold the breach flag below was measured against, so the agent
      // can explain WHY a row is a breach instead of asserting that it is one.
      thresholdPct: def?.thresholdPct,
      rows: rows.map((p) => ({
        period: p.period,
        department: p.department,
        plan: p.plan,
        actual: p.actual,
        forecast: p.forecast,
        variancePct: variancePct(p),
        varianceVsForecastPct: varianceVsForecast(p),
        breach: def ? isBreach(def, p) : false,
      })),
    };
  },
});

/**
 * Backend tool: the ledger's own breach list at the latest CLOSED period, each
 * row carrying whether a narrative has been filed against it. `explained` is
 * the field beat 6 turns on — an unexplained breach is what the publish gate
 * refuses on — so it is returned verbatim rather than summarized away.
 */
export const listExceptionsTool = defineTool({
  name: "list_exceptions",
  description:
    "List the variance exceptions at the latest closed period — every metric " +
    "whose actual moved further from plan than its own threshold allows. Each " +
    "row says whether a variance narrative has been filed for it " +
    "('explained'). Call this for 'what needs explaining', 'what's off plan', " +
    "or before assembling or publishing a board pack.",
  parameters: z.object({}),
  execute: async () => ({ exceptions: store.exceptions() }),
});

/**
 * BEAT 1 — the block that lands in the chat.
 *
 * The agent picks a small selection (`BlockSpec`); `buildBlockOps` expands it
 * deterministically into A2UI operations, which the A2UI middleware turns into
 * an `a2ui-surface` activity the shell renders INLINE (a `block:`-prefixed
 * surface id is what routes it to the transcript rather than to a canvas).
 * Building the ops in code, rather than having the model author component JSON,
 * is what keeps generation fast and reliable — the model emits only the tiny
 * selection, and the block binds live figures on the client.
 *
 * The block is created as a DRAFT (`store.createDraftBlock`): it exists, it can
 * be pinned by the "Add to dashboard" control the ops carry OR by the frontend
 * `pinBlockToDashboard` tool (`./tools.tsx`), and until one of those runs it is
 * on no dashboard at all. A rendered block is not a pin.
 *
 * The draft's id is returned alongside the ops as `blockId`, which is the ONLY
 * handle `pinBlockToDashboard` accepts — without it the agent could compose the
 * three blocks beat 5's saved procedure asks for and then have no way to pin
 * any of them.
 */
const renderMetricBlockParams = z
  .object({
    kind: z
      .enum([
        "metricTile",
        "trendLine",
        "varianceBar",
        "initiativeTable",
        "exceptionList",
      ])
      .describe(
        "metricTile = one KPI with its delta; trendLine = one metric over " +
          "time; varianceBar = actual vs plan for one metric (per-department " +
          "metrics only); initiativeTable = the initiative roster; " +
          "exceptionList = the current variance exceptions.",
      ),
    title: z
      .string()
      .describe(
        "A short LABEL for the block — no figures, percentages or trend " +
          "claims; the block binds its own live data.",
      ),
    metricId: metricId
      .optional()
      .describe(
        "REQUIRED for metricTile, trendLine and varianceBar — each renders " +
          "exactly one metric. Omit only for initiativeTable and " +
          "exceptionList, which bind their own rows.",
      ),
    department: department
      .optional()
      .describe(
        "Scopes the block to one department. Only meaningful for the " +
          "per-department metrics ('opex', 'headcountCost').",
      ),
    compare: z
      .enum(["plan", "forecast"])
      .optional()
      .describe("What a metricTile's delta is measured against."),
    months: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("A trendLine's trailing window in months (default 12)."),
  })
  // The catalog REQUIRES `metricId` for the three metric-bound kinds and the op
  // builder forwards it unguarded, so a metricTile without one reaches the
  // client as a tile bound to nothing: a block that renders empty, on stage,
  // with no error anywhere. Refuse it at the boundary instead, with a message
  // that tells the model exactly what to send next.
  .superRefine((spec, ctx) => {
    const metricBound =
      spec.kind === "metricTile" ||
      spec.kind === "trendLine" ||
      spec.kind === "varianceBar";
    if (metricBound && !spec.metricId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["metricId"],
        message:
          `A "${spec.kind}" block renders exactly one metric, so metricId is ` +
          `required. Pass the metric this block is about, or choose a kind ` +
          `that binds its own rows (initiativeTable, exceptionList).`,
      });
    }
  });

export const renderMetricBlockTool = defineTool({
  name: "render_metric_block",
  description:
    "Render a dashboard BLOCK inline in the chat — a live metric tile, trend " +
    "line, variance bar, initiative table or exception list. This is how you " +
    "SHOW a number: the block binds live figures on the client, so never pass " +
    "or restate numbers. The block arrives with an 'Add to dashboard' control; " +
    "rendering it pins nothing. The result carries a 'blockId' — that is the " +
    "id you pass to pinBlockToDashboard if this block is meant to land on a " +
    "dashboard. Always pair the block with one sentence of prose answering " +
    "what was actually asked.",
  parameters: renderMetricBlockParams,
  execute: async (spec) => {
    const block = store.createDraftBlock(spec);
    return {
      [A2UI_OPERATIONS_KEY]: buildBlockOps(spec, block.id),
      blockId: block.id,
    };
  },
});

/**
 * Whether a string is one of the ledger's variance codes.
 *
 * ⚠️ BEAT 6's WITHHELD VOCABULARY — READ BEFORE TOUCHING. The publish gate is
 * cleared by FILING a narrative, so an agent that can invent a code that the
 * ledger accepts clears the gate on its own, never asks to be taught, and the
 * teach arc silently stops existing. The codes are therefore withheld from the
 * model on every channel: the `code` parameter below is a free `z.string()`
 * (never a `z.enum`, which would publish the catalogue straight into the tool's
 * JSON schema), no description or prompt line names one, and the refusal this
 * guard produces names none either.
 *
 * The literals live INSIDE this predicate on purpose: it is a REJECTION set,
 * not a vocabulary. Nothing here is ever serialized towards the model — the
 * agent learns which code works by WATCHING the operator file one on the
 * filing form, which is the whole of beat 6.
 */
function isNarrativeCode(code: string): code is NarrativeCode {
  // Typed as `Record<NarrativeCode, true>` so this is EXHAUSTIVE at compile
  // time: a code added to the union in `./data/types.ts` breaks this line until
  // it is handled here too, rather than being silently refused at runtime.
  // Declared inside the predicate, never at module scope, so there is no
  // catalogue object in this file for anything agent-facing to reach for.
  const accepted: Record<NarrativeCode, true> = {
    "VAR-TIMING": true,
    "VAR-ONEOFF": true,
    "VAR-FX": true,
    "VAR-PLAN": true,
  };
  return Object.prototype.hasOwnProperty.call(accepted, code);
}

/**
 * BEAT 3a / 3d / 6 — file the explanation a breach is waiting on.
 *
 * `source` is not the agent's to choose freely: a narrative typed from what the
 * operator said is `"typed"`, and one whose body was read out of an attached
 * document is `"ingested-memo"`. The distinction is a provenance record on the
 * filed row — the board pack can say where an explanation came from — so it is
 * driven by one explicit boolean flag rather than inferred from the body text.
 */
export const fileVarianceNarrativeTool = defineTool({
  name: "file_variance_narrative",
  description:
    "File a variance narrative against one metric and period — the written " +
    "explanation an exception is waiting on. When the body is drawn from a " +
    "document the user attached, set ingestedFromAttachment true AND say in " +
    "your reply that the explanation came from that document. YOU DO NOT KNOW " +
    "THE CODES: the catalogue lives on the operator's filing form, is " +
    "deliberately not published to you, and only the operator or a saved " +
    "procedure can give you one. Call this ONLY with a code you were handed, " +
    "VERBATIM — never invent one, never guess, and never file one to see what " +
    "happens.",
  parameters: z.object({
    metricId: metricId.describe("The metric the narrative explains."),
    period: z
      .string()
      .describe('The period it explains, as "YYYY-MM" (e.g. "2026-08").'),
    code: z
      .string()
      .describe(
        "The exact code, copied verbatim from what the operator told you or " +
          "from a saved procedure. The valid codes are WITHHELD from you on " +
          "purpose — you cannot derive one, so do not try.",
      ),
    body: z
      .string()
      .describe("The explanation itself, in prose: what happened and why."),
    ingestedFromAttachment: z
      .boolean()
      .optional()
      .describe(
        "True when this body was read out of a document the user attached, " +
          "so the filing records where the explanation came from.",
      ),
  }),
  execute: async ({
    metricId: id,
    period,
    code,
    body,
    ingestedFromAttachment,
  }) => {
    if (!isNarrativeCode(code)) {
      // Names no valid code: an agent handed the catalogue in a refusal has
      // been handed the catalogue. It says what to do instead, which is ask.
      return {
        error: "BAD_CODE",
        message:
          `"${code}" is not a code this ledger files under. You cannot ` +
          `derive one — ask the operator which code applies, or follow a ` +
          `saved procedure that names one, and file it verbatim.`,
      };
    }
    return {
      narrative: store.fileNarrative({
        metricId: id,
        period,
        code,
        body,
        source: ingestedFromAttachment ? "ingested-memo" : "typed",
      }),
    };
  },
});

/**
 * BEAT 6's GATE — publish, or read back exactly why not.
 *
 * ⚠️ EXPORTED BUT DELIBERATELY NOT REGISTERED. It is absent from `execAgent()`'s
 * `tools` array on purpose: the PIN is beat 3a's withheld secret, so the agent's
 * only publish path is the frontend `confirmPublishCountersign` card, which
 * POSTs `/api/exec/v1/packs` itself and hands the agent back the verbatim
 * refusal (`./tools.tsx`). Registering this tool as well would advertise a
 * second publish route the agent can only ever call with a PIN it invented —
 * exactly the retry EXEC_PROMPT rules 4 and 6 forbid. The export stays because
 * `agent-tools.test.ts` invokes its `execute` directly to pin the SHAPE the gate
 * reads back, and because the REST route it wraps is the same one the card uses.
 *
 * The refusal is returned VERBATIM (`{ error: code, breaches }`, the same shape
 * the REST route sends): the teach arc only fires if the agent SEES
 * `UNEXPLAINED_VARIANCE` and the breaches behind it, rather than a swallowed,
 * reshaped or summarized error. Keel's `render_impact_brief` error shape makes
 * the same argument from the other side — a tool that returns nothing useful on
 * failure gets retried identically.
 */
export const publishBoardPackTool = defineTool({
  name: "publish_board_pack",
  description:
    "Publish a dashboard as a board pack. Requires the countersign PIN, which " +
    "you DO NOT know and must never guess, request, or repeat — it is typed " +
    "into the countersign card and reaches this tool from there. Publishing " +
    "is refused while the dashboard's metrics have unexplained variance; when " +
    "it is refused, relay the refusal as given and do not work around it.",
  parameters: z.object({
    dashboardId: z
      .enum(["ceo", "cfo"])
      .describe("Which dashboard to publish as a pack."),
    countersignPin: z
      .string()
      .describe(
        "The PIN exactly as the countersign card supplied it. Never compose " +
          "or guess digits.",
      ),
  }),
  execute: async ({ dashboardId, countersignPin }) => {
    const result = store.publishPack(dashboardId, countersignPin);
    if (!result.ok) {
      return {
        error: result.code,
        ...("breaches" in result ? { breaches: result.breaches } : {}),
      };
    }
    return { pack: result.pack };
  },
});

const EXEC_PROMPT = `You are Vantage, the executive reporting assistant embedded in Cascade
Industries' board desk. The people you talk to are the CEO, the CFO and their
chief of staff, between meetings. Your job is to put the right figure on screen,
explain what moved, and drive the desk — file the narratives an exception is
waiting on, compose the blocks a dashboard is made of, and take a board pack to
the gate that governs publishing it. Use the provided tools.

1. NEVER STATE A FIGURE YOU DID NOT READ. Call get_metrics (or list_exceptions)
before you quote any number, variance, direction or trend. You do NOT know
Cascade's revenue, opex, margin or headcount from memory, and a confidently
invented figure in a board conversation is the single most damaging thing you
can do in this app. The variance on each row is already computed for you — read
it, do not recompute it, and do not round a breach away.

2. A BLOCK IS SHOWN, AN ANSWER IS SAID — ALWAYS BOTH. Every render_metric_block
call is paired with ONE sentence of prose that answers what was actually asked
("Distribution opex ran 9% over plan in the latest closed month"). The block
replaces LISTING the raw numbers; it never replaces the answer. A block with no
sentence is a chart handed to someone who asked a question, and a sentence with
no block is a number nobody can see. If the user asked no specific question, one
short takeaway sentence is enough. Never write a markdown table — blocks are how
structured data is shown here.

3. BLOCKS ARE THE SURFACE. This desk has NO canvas report tool: a single metric
renders as an INLINE BLOCK in the chat, and those blocks ARE the story on
screen. Do not look for a canvas report tool, do not apologise for not having
one, and do not describe a dashboard in prose as a substitute. Several things to
show means several blocks, one call each, each with its own sentence. Rendering
a block pins NOTHING: it arrives with an "Add to dashboard" control, and the
dashboards only grow when the operator uses that control OR you call
pinBlockToDashboard with the blockId render_metric_block gave you.

4. YOU DO NOT KNOW THE COUNTERSIGN PIN. Publishing a board pack is countersigned
by a HUMAN, and confirmPublishCountersign is the ONLY way you publish one. Call
it so the operator types the PIN into the card; you will never see, ask for,
receive or repeat those digits, and you must never invent them or compose a PIN
of your own. A publish refused for BAD_COUNTERSIGN is the card's business, not a
puzzle.

5. YOU DO NOT KNOW THE NARRATIVE CODES EITHER. The catalogue a variance
narrative is filed under is the operator's — it lives on the filing form, is
deliberately not given to you, and only the operator or a saved procedure can
hand you one. So do not guess a code, do not invent one, and do not file one to
see what happens: a wrong code is refused and explains nothing. If you have no
code, say so plainly and ask, or follow the procedure that names one. Quote
whatever you are given VERBATIM.

6. A PUBLISH REFUSED FOR UNEXPLAINED VARIANCE — ACTION DISCIPLINE.
A publish is refused with UNEXPLAINED_VARIANCE — the refusal comes back as
confirmPublishCountersign's result, the only publish path you have — and the
exact breaches behind it while a dashboard's metrics have variance nobody has
explained. Handle it in this order and no other.
  1. Call recall_memory and look for a saved procedure for publishing a pack
     that was refused for unexplained variance. If you find one, FOLLOW IT
     exactly, then re-attempt the SAME publish that was refused. Do not offer to
     record anything: you already know this one.
  2. If nothing comes back, STOP AND SAY SO. Say in one plain sentence which
     metrics are unexplained and that you do not have a saved way past this,
     then call offerWorkflowRecording. That call IS how you ask — do not ask in
     prose instead.
  3. While you are blocked, do not do something else that looks helpful. Do not
     guess a narrative code (rule 5), do not re-publish hoping for a different
     answer, do not remove the offending block from the dashboard to make the
     refusal go away, and do not offer the countersign card as a way past it — a
     PIN confirms WHO is publishing, never WHAT may be published. There is no
     partial credit for doing something plausible.
  4. When the operator agrees to show you, call awaitDemonstration and WAIT. Do
     NOT tell them where to click, do not list steps, and do not name a code —
     you do not know the procedure, which is the entire reason you are watching.
  5. That tool hands back the steps it observed and the exact code the operator
     filed. Call saveLearnedProcedure with a numbered procedure quoting that
     code VERBATIM, then do exactly what its result tells you about persisting
     it. The period they demonstrated on is ALREADY explained — do not re-file
     the same narrative before re-attempting the publish.

7. AN OUT-OF-PLAN MONTH IS EXPLAINED BY FILING, NOT BY TALKING. When the
operator asks you to explain, write up or account for a variance, call
file_variance_narrative with the metric, the period, the code you were given and
the explanation in prose. Filing is what clears an exception; saying what you
would file clears nothing. When the explanation comes from a document the
operator attached, take the figures, the period and the drivers FROM THE
DOCUMENT — those are the facts only a reader of the attachment knows — set
ingestedFromAttachment true, and SAY in your reply that the explanation came
from that memo. Never restate the attachment as if you had known it.

8. SCREEN AWARENESS — YOUR CONTEXT IS THE SCREEN. Everything you are given is a
description of what the executive is looking at RIGHT NOW: the route readable
names the page they are on, and each page's own readable describes what is
VISIBLY on it — which dashboard, the blocks pinned to it in the order shown, the
explorer's active levers and the rows those levers admit, the packs already
published. Answer from all of it confidently and specifically. When asked "what
am I looking at?", say the page by name (CEO dashboard, CFO dashboard, Metrics,
Board packs), then read back what is actually on it. NEVER say you cannot see,
inspect or read the screen, never ask the user to describe it, and never hedge
that you "only know from context" — that context IS the screen. If one specific
figure is genuinely absent from your context, say that one figure is unavailable
and answer the rest.

9. THE EXPLORER'S LEVERS ARE A MANEUVER, NOT A LINK. When the operator asks for
the worst variances, a department's metrics, or a slice of the ledger, use
navigateTo with the explorer's levers set — department, period, threshold and
top-N — so the app's real controls move on screen. Set only the levers the
request implies and leave the others unset; a filter the operator did not ask
for narrows the board for no reason and claims a choice they never made.
Afterwards, say what the board is now showing.

10. COMPOSITION PREFERENCES ARE REMEMBERED, AND SAYING SO IS THE POINT. Before
you compose ANY block or summarize how this desk reads its numbers, call
recall_memory first and look for the standing preferences about how blocks are
composed. Apply what you find, and then SAY WHICH ONE YOU APPLIED, in your own
words, in the sentence that accompanies the block — "I've shown growth QoQ and
kept EBITDA in the headline, the way you read these". A preference applied
silently is indistinguishable from a coincidence. Speak like someone who
remembers, not like a system reporting a cache hit. If recall_memory comes back
with nothing, say so plainly rather than inventing a preference. Call
recall_memory at most once for a composition preference per operator message;
that throttle does not apply to the separate recall a refused publish requires
(rule 6).

11. A SAVED PROCEDURE IS EXECUTED, NOT DESCRIBED. When the operator asks for
something a saved procedure covers — assembling the month-end board pack, however
vaguely they put it — recall it and RUN it, step by step, immediately, without
asking for confirmation between steps. Every step is EXECUTABLE, pinning
included: a step that says to put blocks on a dashboard means calling
pinBlockToDashboard once per block, with the blockId each render_metric_block
call handed back — never a sentence saying you would. When every step is done,
confirm what you did in ONE short sentence. Assembling a pack is a DIFFERENT
situation from
getting a refused publish past unexplained variance (rule 6); do not confuse the
two, and do NOT offer to record anything here — you already know this one, and
offering to learn a procedure you are in the middle of running is the single most
confusing thing you can do on this screen.

12. GENERAL MEMORY
- Recall before you answer anything a standing preference could change.
- Save durable preferences and procedures the operator teaches you. Never save a
  one-off figure, the countersign PIN, or anything read out of a document they
  attached.
- Saving is not recalling: calling one does not do the other.
- Classify what you save — kind "topical" for preferences, "operational" for
  procedures — and always use scope "user". This deployment shares one memory
  backend with other products, and a project-scoped row leaks into all of them.
- Save a given fact once. Supersede rather than adding a near-duplicate.
- Never stop mid-procedure to save something. Finish the procedure first.

OPEN GENERATIVE UI. generateSandboxedUi is for genuinely novel UI this desk has
no block for — an interactive what-if explorer, a treemap, something the block
catalog cannot express. Do not reach for it when render_metric_block would do:
every metric, trend, variance, initiative and exception view goes through
render_metric_block, which binds live figures on the client. When you do use it,
obtain every figure through the exposed sandbox functions rather than typing
numbers into the generated markup.

Backend tools available to you: get_metrics and list_exceptions to READ the
ledger (rule 1), render_metric_block to SHOW it (rules 2 and 3), and
file_variance_narrative to explain a breach (rules 5 and 7).

Frontend tools available to you: pinBlockToDashboard to pin a block you already
rendered onto a dashboard (rules 3 and 11), navigateTo to move the desk and set
the explorer's levers (rule 9), confirmPublishCountersign to take a dashboard to
the countersign gate (rules 4 and 6), and the teach chain
offerWorkflowRecording / awaitDemonstration / saveLearnedProcedure (rule 6).

Keep prose tight and executive: short sentences, the movement before the level,
no filler. Render the block instead of describing its data, then add at most one
or two sentences of guidance.`;

/**
 * The Vantage (exec) skin's agent. Exported as a factory — mirroring keel's
 * `keelAgent` — so the runtime route and the per-skin agent map can key it by
 * id. Keyed by the same id as the skin: "exec".
 */
export const execAgent = () =>
  new BuiltInAgent({
    // `openai/gpt-5.4` is the alias used across the repo; the full (non-mini)
    // model routes the multi-step arc more reliably.
    model: "openai/gpt-5.4",
    prompt: EXEC_PROMPT,
    // `publishBoardPackTool` is DELIBERATELY absent — see its doc comment.
    tools: [
      getMetricsTool,
      listExceptionsTool,
      renderMetricBlockTool,
      fileVarianceNarrativeTool,
    ],
    // Temperature 0 for deterministic tool routing — every other skin pins it
    // for the same reason. The scripted arc (render → file → publish → teach)
    // needs the agent to pick the same path every time, not sample
    // alternatives, or the demo drifts between run-throughs.
    temperature: 0,
  });
