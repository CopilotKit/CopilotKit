/**
 * Linear cycle standup — `/standup` and prompt-triggerable (`render_standup`).
 *
 * Posts a shadcn card showing **per-team progress** through each team's active
 * cycle — one labelled progress meter per team ("OSS · 40% · 8/20") — plus a
 * done-vs-remaining stacked bar comparing scope across teams. Linear has no
 * public read, so this needs `LINEAR_API_KEY` (personal API key); without it —
 * or on any error — it falls back to sample data and says so.
 */
import { createElement as h } from "react";
import type { ReactElement } from "react";
import { z } from "zod";
import { defineChannelTool, defineChannelCommand } from "@copilotkit/channels";
import { StackedBar, Meter } from "@copilotkit/channels/charts";
import { GEIST } from "./theme.js";
import { FETCH_TIMEOUT_MS, sampleTag } from "./lib.js";
import type { ShowcaseThread } from "./lib.js";

interface TeamProgress {
  name: string;
  cycleName: string;
  done: number;
  total: number;
  pct: number;
}
interface Standup {
  teams: TeamProgress[];
  live: boolean;
}

const SAMPLE: Standup = {
  teams: [
    { name: "OSS", cycleName: "Cycle 42", done: 8, total: 20, pct: 40 },
    { name: "Epic", cycleName: "Cycle 12", done: 6, total: 20, pct: 30 },
    { name: "Platform", cycleName: "Cycle 27", done: 14, total: 22, pct: 64 },
    { name: "Docs", cycleName: "Cycle 9", done: 5, total: 8, pct: 63 },
  ],
  live: false,
};

interface LinearTeam {
  name: string;
  activeCycle: {
    name: string | null;
    number: number;
    issues: { nodes: { state: { type: string } | null }[] };
  } | null;
}
interface LinearResp {
  data?: { teams: { nodes: LinearTeam[] } };
  errors?: { message: string }[];
}

// All teams + their active cycle's issue states, so we can compute per-team
// completion. Teams without an active cycle are dropped below.
const QUERY = `query {
  teams(first: 50) {
    nodes {
      name
      activeCycle { name number issues(first: 250) { nodes { state { type } } } }
    }
  }
}`;

let warnedNoKey = false;

async function fetchStandup(): Promise<Standup> {
  const key = process.env["LINEAR_API_KEY"];
  if (!key) {
    // Expected in the default showcase (no Linear configured) — log ONCE so a
    // mis-set env var is discoverable without spamming a line on every /standup.
    if (!warnedNoKey) {
      warnedNoKey = true;
      console.info(
        "[showcase] cycle standup: LINEAR_API_KEY not set — using sample data.",
      );
    }
    return SAMPLE; // Linear has no public read — sample without a key.
  }
  try {
    const res = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: key },
      body: JSON.stringify({ query: QUERY }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Linear ${res.status} ${res.statusText}`);
    const json = (await res.json()) as LinearResp;
    if (json.errors?.length)
      throw new Error(json.errors.map((e) => e.message).join("; "));
    const teams: TeamProgress[] = (json.data?.teams.nodes ?? [])
      .filter(
        (
          t,
        ): t is LinearTeam & {
          activeCycle: NonNullable<LinearTeam["activeCycle"]>;
        } => Boolean(t.activeCycle && t.activeCycle.issues.nodes.length),
      )
      .map((t) => {
        const issues = t.activeCycle.issues.nodes;
        const done = issues.filter((i) => i.state?.type === "completed").length;
        const total = issues.length;
        return {
          name: t.name,
          cycleName: t.activeCycle.name ?? `Cycle ${t.activeCycle.number}`,
          done,
          total,
          pct: Math.round((done / total) * 100),
        };
      })
      .sort((a, b) => b.total - a.total);
    if (!teams.length)
      throw new Error("no teams have an active cycle with issues");
    return { teams, live: true };
  } catch (err) {
    console.warn(
      "[showcase] cycle standup: Linear fetch failed, using sample data —",
      err,
    );
    return SAMPLE;
  }
}

/** green ≥66% · amber ≥33% · red below — the meter fill colour. */
function pctColor(pct: number): string {
  if (pct >= 66) return "#22c55e";
  if (pct >= 33) return "#f59e0b";
  return "#ef4444";
}

/** One team row: name + "pct% · done/total" over a progress meter. */
function teamRow(t: TeamProgress): ReactElement {
  return h(
    "div",
    {
      key: t.name,
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 6,
        width: "100%",
      },
    },
    h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "row",
          justifyContent: "space-between",
          width: "100%",
        },
      },
      h(
        "span",
        { className: "fg", style: { fontSize: 16, fontWeight: 600 } },
        `${t.name} · ${t.cycleName}`,
      ),
      h(
        "span",
        { className: "muted", style: { fontSize: 15 } },
        `${t.pct}% · ${t.done}/${t.total} done`,
      ),
    ),
    h(Meter, { value: t.pct / 100, height: 14, colors: [pctColor(t.pct)] }),
  );
}

export function StandupCard(s: Standup): ReactElement {
  const teams = s.teams.slice(0, 8);
  return h(
    "div",
    {
      className: "card",
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 18,
        width: "100%",
        height: "100%",
        padding: 28,
        fontFamily: GEIST,
      },
    },
    h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
        },
      },
      h(
        "span",
        { className: "title", style: { fontSize: 24 } },
        "Cycle progress by team",
      ),
      h(
        "span",
        {
          className: s.live ? "badge badge-green" : "badge badge-amber",
          style: { fontSize: 12, padding: "4px 12px" },
        },
        s.live ? "live · linear" : "sample data",
      ),
    ),
    h(
      "span",
      { className: "muted", style: { fontSize: 14 } },
      `${s.teams.length} team${s.teams.length === 1 ? "" : "s"} with an active cycle`,
    ),
    h("div", { className: "divider", style: { height: 1, width: "100%" } }),
    h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: 16,
          width: "100%",
        },
      },
      ...teams.map(teamRow),
    ),
  );
}

export async function renderStandup(thread: ShowcaseThread): Promise<string> {
  const s = await fetchStandup();
  const height = 150 + Math.max(1, Math.min(s.teams.length, 8)) * 54;
  // Lead with a text summary (see renderPrRadar) — captions the images and lets
  // a later turn see this was already handled.
  await thread.post(
    `*Cycle progress by team* — ${s.teams.length} active cycle${s.teams.length === 1 ? "" : "s"}${s.live ? "" : " · sample data"}`,
  );
  await thread.post(<StandupCard {...s} />, {
    filename: "standup.png",
    title: "Cycle progress by team",
    width: 760,
    height,
  });
  // Stacked done-vs-remaining per team: bar height = scope, green = done,
  // grey = remaining. Colours are explicit so "done" reads green everywhere.
  await thread.post(
    <StackedBar
      title={`Done vs remaining by team${sampleTag(s.live)}`}
      data={s.teams
        .slice(0, 8)
        .map((t) => ({ label: t.name, values: [t.done, t.total - t.done] }))}
      colors={["#22c55e", "#3f3f46"]}
      width={760}
      height={420}
    />,
    { filename: "cycle-load.png", width: 760, height: 420 },
  );
  const totalDone = s.teams.reduce((a, t) => a + t.done, 0);
  const totalScope = s.teams.reduce((a, t) => a + t.total, 0);
  return s.live
    ? `Posted cycle progress — ${totalDone}/${totalScope} issues done across ${s.teams.length} team(s).`
    : "Posted cycle progress (no LINEAR_API_KEY or Linear unreachable, so this is sample data).";
}

export const standupTool = defineChannelTool({
  name: "render_standup",
  description:
    "Post the cycle standup: per-team progress through each team's active Linear cycle (a labelled progress meter per team) plus a done-vs-remaining stacked bar. Live Linear data when LINEAR_API_KEY is set.",
  parameters: z.object({}),
  async handler(_args, { thread }) {
    return renderStandup(thread);
  },
});

export const standupCommand = defineChannelCommand({
  name: "standup",
  description: "Show per-team progress through the current Linear cycles.",
  async handler({ thread }) {
    await renderStandup(thread);
  },
});
