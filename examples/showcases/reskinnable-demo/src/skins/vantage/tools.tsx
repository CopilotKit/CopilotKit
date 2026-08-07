"use client";

import { z } from "zod";
import { useRouter } from "next/navigation";
import {
  useAgentContext,
  useComponent,
  useFrontendTool,
  useHumanInTheLoop,
} from "@copilotkit/react-core/v2";
import { revalidateVantage, useMetricCatalog, useSources } from "./data/hooks";
import { useVantageHref } from "./href";
import { lensFields, lensSummary, lensToParams, parseLens } from "./data/lens";
import { KpiRowCard } from "./components/gen-ui/kpi-row-card";
import { TrendCard } from "./components/gen-ui/trend-card";
import { BreakdownCard } from "./components/gen-ui/breakdown-card";
import { WaterfallCard } from "./components/gen-ui/waterfall-card";
import { DealTableCard } from "./components/gen-ui/deal-table-card";
import { BoardCard } from "./components/gen-ui/board-card";
import { SourceConnectCard } from "./components/source-connect-card";
import { LeverConfirmCard } from "./components/lever-confirm-card";

const METRIC_ENUM = z.enum([
  "arr",
  "nrr",
  "pipeline_coverage",
  "cac_payback",
  "logo_churn",
  "magic_number",
]);

/**
 * Every chart tool carries this. Without it the model renders the right chart
 * and never addresses the question — chart, then silence — which reads as a
 * glitch on stage.
 */
const CHART_ANSWER_RULE =
  " After the chart renders, ALSO answer the user's specific question in one or " +
  "two sentences grounded in the figures — the chart replaces listing the raw " +
  "numbers, not your answer. Bold the key figure. If they asked nothing " +
  "specific, one short takeaway sentence is enough.";

export function VantageTools() {
  const router = useRouter();
  // Every path this component hands to the router — or quotes AT the model —
  // goes through the builder, so a locked deploy never navigates to, or reads
  // out, a `/vantage/...` URL it does not serve. Memoized on the lock state, so
  // it is stable and safe in the dependency arrays below.
  const vantageHref = useVantageHref();
  const { metrics } = useMetricCatalog();
  const { sources } = useSources();

  // GLOBAL readables: what the app can do and what its vocabulary is. The route
  // readable is in layout.tsx; the per-page ones are in each page component.
  useAgentContext({
    description:
      "The metric catalog for this company, with each metric's agreed " +
      "definition and whether Finance has certified it. Use the exact metric " +
      "ids when calling tools; never invent one. An uncertified metric may be " +
      "explored but is not agreed across Finance.",
    value: JSON.stringify(
      metrics.map((m) => ({
        id: m.id,
        label: m.label,
        unit: m.unit,
        definition: m.definition,
        certified: m.certified,
        owner: m.owner,
      })),
    ),
  });

  useAgentContext({
    description: "The warehouse sources currently connected to Vantage.",
    value: JSON.stringify(
      sources.map((s) => ({
        name: s.name,
        warehouse: s.warehouse,
        tables: s.tableCount,
      })),
    ),
  });

  // ── Gen-UI charts ──────────────────────────────────────────────────────────
  // Each card takes only the tool ARGUMENTS and fetches its own figures, so it
  // closes over nothing mutable. That is why `[]` is correct here — and it is
  // what makes these replay-safe: reopening a thread replays the recorded args
  // and the card refetches. No `status`, no live-only client state.

  useComponent(
    {
      name: "showKpiRow",
      description:
        "Render the headline KPI tiles (ARR, pipeline coverage, CAC payback, " +
        "logo churn) as a component in the chat. Call this for any question " +
        "about how the quarter/period is going, how we closed, or overall " +
        "performance — never answer that in prose alone." +
        CHART_ANSWER_RULE,
      parameters: z.object({
        ...lensFields,
        title: z.string().optional().describe("Short heading above the tiles."),
        note: z
          .string()
          .optional()
          .describe("One short footnote under the tiles."),
      }),
      render: ({ title, note, ...lensArgs }) => (
        <KpiRowCard lens={parseLens(lensArgs)} title={title} note={note} />
      ),
    },
    [],
  );

  useComponent(
    {
      name: "showTrend",
      description:
        "Render a metric's trend over time as a chart in the chat. Use for any " +
        "question about history, trajectory, or how something has changed." +
        CHART_ANSWER_RULE,
      parameters: z.object({
        metric: METRIC_ENUM.describe("Which metric to plot."),
        ...lensFields,
        title: z.string().optional(),
        note: z.string().optional(),
      }),
      render: ({ metric, title, note, ...lensArgs }) => (
        <TrendCard
          lens={parseLens(lensArgs)}
          metric={metric}
          title={title}
          note={note}
        />
      ),
    },
    [],
  );

  useComponent(
    {
      name: "showBreakdown",
      description:
        "Render a metric split by segment, region or channel as a bar chart in " +
        "the chat. Use when the user asks where something came from, which " +
        "segment/region drove it, or for a mix or contribution question." +
        CHART_ANSWER_RULE,
      parameters: z.object({
        metric: METRIC_ENUM,
        dimension: z
          .enum(["segment", "region", "channel"])
          .describe("Which dimension to split by."),
        ...lensFields,
        title: z.string().optional(),
        note: z.string().optional(),
      }),
      render: ({ metric, dimension, title, note, ...lensArgs }) => (
        <BreakdownCard
          lens={parseLens(lensArgs)}
          metric={metric}
          dimension={dimension}
          title={title}
          note={note}
        />
      ),
    },
    [],
  );

  useComponent(
    {
      name: "showPlanVariance",
      description:
        "Render the plan-variance waterfall — plan, then each region's " +
        "contribution to the gap, then actual. Use whenever the user asks WHY a " +
        "number missed or beat plan, or who drove a shortfall. This is the " +
        "right tool for 'why did we miss?' — it attributes the gap rather than " +
        "just showing it." +
        CHART_ANSWER_RULE,
      parameters: z.object({
        ...lensFields,
        title: z.string().optional(),
        note: z.string().optional(),
      }),
      render: ({ title, note, ...lensArgs }) => (
        <WaterfallCard
          lens={parseLens({ ...lensArgs, compare: "vs-plan" })}
          title={title}
          note={note}
        />
      ),
    },
    [],
  );

  useComponent(
    {
      name: "showDeals",
      description:
        "Render a list of deals as a table component. Use for slipped deals, " +
        "large open deals, or anything deal-level. NEVER write a markdown " +
        "table — call this instead." +
        CHART_ANSWER_RULE,
      parameters: z.object({
        status: z.enum(["slipped", "won", "open"]).optional(),
        region: z.enum(["namer", "emea", "apac"]).optional(),
        minValue: z
          .number()
          .optional()
          .describe("Only deals worth at least this many USD, e.g. 250000."),
        title: z.string().optional(),
        note: z.string().optional(),
      }),
      render: ({ status, region, minValue, title, note }) => (
        <DealTableCard
          status={status}
          region={region}
          minValue={minValue}
          title={title}
          note={note}
        />
      ),
    },
    [],
  );

  useComponent(
    {
      name: "showBoard",
      description:
        "Show a link card for a board that exists in the app. Call this right " +
        "after buildBoard so the user can open the board you just filed.",
      parameters: z.object({
        boardId: z
          .string()
          .describe("The board id or slug returned by buildBoard."),
        note: z
          .string()
          .optional()
          .describe("One short line on why the board is shaped the way it is."),
      }),
      render: ({ boardId, note }) => (
        <BoardCard boardId={boardId} note={note} />
      ),
    },
    [],
  );

  // ── Beat 3a: connect a warehouse, secret never leaves the UI ───────────────
  useHumanInTheLoop(
    {
      name: "connectSource",
      description:
        "Offer to connect a data warehouse to Vantage. Renders a form in the " +
        "chat where the user picks the warehouse and enters the credential " +
        "themselves. Call this IMMEDIATELY when the user asks to connect, add or " +
        "hook up a warehouse or data source. NEVER ask for the token, never ask " +
        "which warehouse first, and never repeat a credential.",
      parameters: z.object({}),
      followUp: false,
      // Keyed off `result`, not `status`: a replayed thread has the recorded
      // result and no live transition, so an answered call must never come back
      // showing a live form that could post a second time.
      render: ({ result, respond }) => {
        const answer = typeof result === "string" ? result : "";
        if (answer) {
          return (
            <SourceConnectCard
              status={answer.startsWith("Connected") ? "connected" : "declined"}
              result={answer}
              onConnect={() => {}}
              onCancel={() => {}}
            />
          );
        }
        return (
          <SourceConnectCard
            status="asking"
            onConnect={async ({ name, warehouse, token }) => {
              try {
                const res = await fetch("/api/vantage/v1/sources", {
                  method: "POST",
                  body: JSON.stringify({ name, warehouse, token }),
                });
                if (!res.ok) {
                  const body = await res.json().catch(() => ({}));
                  // Report the SYMPTOM, never the credential.
                  respond?.(
                    `Could not connect ${name}: ${body.message ?? `HTTP ${res.status}`}`,
                  );
                  return;
                }
                const { source } = await res.json();
                revalidateVantage();
                // The agent learns the outcome and NOTHING about the token.
                respond?.(
                  `Connected to ${source.name} — ${source.tableCount} tables available.`,
                );
              } catch (err) {
                respond?.(
                  `Could not connect ${name}: ${err instanceof Error ? err.message : "unknown error"}`,
                );
              }
            }}
            onCancel={() =>
              respond?.("The user chose not to connect a source now.")
            }
          />
        );
      },
    },
    [],
  );

  // ── Beat 3c: navigate by pulling the real levers ───────────────────────────
  useHumanInTheLoop(
    {
      name: "exploreMetric",
      description:
        "Open the Explore page with specific levers applied — period, " +
        "comparison basis, segment, region, grain and currency. Confirms with " +
        "the user first, naming every lever, then navigates and applies them " +
        "through the page's real query parameters. Use this for any 'why did X " +
        "happen', 'dig into', 'break that down by' or 'show me EMEA' style ask " +
        "that needs the full page rather than an inline chart.",
      parameters: z.object({
        ...lensFields,
        dimension: z
          .enum(["segment", "region", "channel"])
          .optional()
          .describe("Which dimension the breakdown panel should split by."),
      }),
      followUp: false,
      // Keyed off `result`, not `status`: a replayed thread has the recorded
      // result and no live transition, so an answered call must never come back
      // showing live Open/Stay buttons that could navigate and respond again.
      render: ({ args, result, respond }) => {
        const { dimension, ...lensArgs } = args ?? {};
        const lens = parseLens(lensArgs);
        const answer = typeof result === "string" ? result : "";
        if (answer) {
          return (
            <LeverConfirmCard
              status={answer.startsWith("Opened") ? "confirmed" : "declined"}
              levers={[]}
              destination="Explore"
              onConfirm={() => {}}
              onCancel={() => {}}
            />
          );
        }
        return (
          <LeverConfirmCard
            status="asking"
            destination="Explore"
            levers={lensSummary(lens)}
            onConfirm={() => {
              const params = lensToParams(lens);
              if (dimension) params.set("dimension", dimension);
              const qs = params.toString();
              const path = vantageHref("explore");
              router.push(qs ? `${path}?${qs}` : path);
              respond?.(
                `Opened Explore with ${lensSummary(lens)
                  .map((l) => `${l.label}: ${l.value}`)
                  .join(", ")}.`,
              );
            }}
            onCancel={() => respond?.("The user chose to stay on this page.")}
          />
        );
      },
    },
    [router, vantageHref],
  );

  // ── Beat 3d: the durable artifact ─────────────────────────────────────────
  // A frontend tool rather than a component: it WRITES. The board it files is a
  // real resource with its own URL, so it outlives this conversation — delete
  // the thread and the board is still in the nav.
  useFrontendTool(
    {
      name: "buildBoard",
      description:
        "File a new board into the app. Use this whenever the user asks you to " +
        "build, create, assemble or rebuild a dashboard, board or review — " +
        "including when rebuilding the structure of an uploaded deck with " +
        "current numbers. The board becomes a real page at " +
        // Built, not written: on a locked deploy the URL the model is told to
        // promise is `/boards/<slug>`, and quoting the prefixed one would have
        // it name a path that 404s.
        `${vantageHref("boards/<slug>")} that survives this conversation. ` +
        "Put any section " +
        "of a source document that maps to NO metric into `notes` rather than " +
        "dropping it or inventing a metric for it. After it is filed, call " +
        "showBoard with the returned id.",
      parameters: z.object({
        title: z.string().describe("Board title, e.g. 'Monday exec review'."),
        summary: z.string().describe("One sentence on what this board is for."),
        tiles: z
          .array(
            z.object({
              kind: z.enum(["kpi", "trend", "breakdown", "waterfall"]),
              metric: METRIC_ENUM,
              label: z.string(),
              dimension: z.enum(["segment", "region", "channel"]).optional(),
            }),
          )
          .min(1)
          .describe("The tiles to place, in reading order."),
        ...lensFields,
        notes: z
          .array(z.string())
          .optional()
          .describe(
            "Findings, or content from a source document that no metric covers.",
          ),
        sourceDocument: z
          .string()
          .optional()
          .describe("Filename of the document this board was built from."),
      }),
      handler: async ({
        title,
        summary,
        tiles,
        notes,
        sourceDocument,
        ...lensArgs
      }) => {
        const res = await fetch("/api/vantage/v1/boards", {
          method: "POST",
          body: JSON.stringify({
            title,
            summary,
            tiles,
            notes,
            sourceDocument,
            lens: parseLens(lensArgs),
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          return `Could not file the board: ${body.message ?? `HTTP ${res.status}`}`;
        }
        const { board } = await res.json();
        // Visible affordance: the Boards page updates behind the chat without a
        // reload, so the audience sees the artifact appear in the app.
        revalidateVantage();
        return `Filed "${board.title}" as a board at ${vantageHref(`boards/${board.slug}`)} (id ${board.id}) with ${board.tiles.length} tiles.`;
      },
    },
    [vantageHref],
  );

  return null;
}

export default VantageTools;
