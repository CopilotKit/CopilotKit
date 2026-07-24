/**
 * Linear cycle standup — `/standup` and prompt-triggerable (`render_standup`).
 *
 * Posts a shadcn card showing **per-team progress** through each team's active
 * cycle — one labelled progress meter per team ("OSS · 40% · 8/20") — plus a
 * done-vs-remaining stacked bar comparing scope across teams. Linear has no
 * public read, so this needs `LINEAR_API_KEY` (personal API key); without it —
 * or on any error — it falls back to sample data and says so.
 */
import { z } from "zod";
import { defineChannelTool, defineChannelCommand } from "@copilotkit/channels";
import type { ChannelNode } from "@copilotkit/channels";
import { StackedBar, Meter } from "@copilotkit/channels/charts";
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

/** Meter fill colour (hex — the Meter chart takes a color, not a class): mint ≥66% · orange ≥33% · red below. */
function pctColor(pct: number): string {
  if (pct >= 66) return "#189370";
  if (pct >= 33) return "#ffac4d";
  return "#d92d20";
}

/** One team row: name + "pct% · done/total" over a progress meter. */
function teamRow(t: TeamProgress): ChannelNode {
  return (
    <div key={t.name} className="flex flex-col gap-1.5 w-full">
      <div className="flex flex-row justify-between w-full">
        <span className="text-base font-semibold text-brand-ink">{`${t.name} · ${t.cycleName}`}</span>
        <span className="text-[15px] text-brand-muted">{`${t.pct}% · ${t.done}/${t.total} done`}</span>
      </div>
      <Meter value={t.pct / 100} height={14} colors={[pctColor(t.pct)]} />
    </div>
  );
}

export function StandupCard(s: Standup): ChannelNode {
  const teams = s.teams.slice(0, 8);
  return (
    <div className="flex flex-col gap-4 w-full h-full p-7 bg-brand-bg rounded-2xl font-brand">
      <div className="flex flex-row items-center justify-between w-full">
        <span className="text-2xl font-bold text-brand-ink">
          Cycle progress by team
        </span>
        <span
          className={`text-xs font-semibold rounded-full px-3 py-1 ${s.live ? "bg-brand-mint text-brand-mint-deep" : "bg-[#ffe8c7] text-[#9a5b00]"}`}
        >
          {s.live ? "live · linear" : "sample data"}
        </span>
      </div>
      <span className="text-sm text-brand-muted">
        {`${s.teams.length} team${s.teams.length === 1 ? "" : "s"} with an active cycle`}
      </span>
      <div className="h-px w-full bg-brand-border" />
      <div className="flex flex-col gap-4 w-full">{teams.map(teamRow)}</div>
    </div>
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
      colors={["#189370", "#e5e7eb"]}
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
