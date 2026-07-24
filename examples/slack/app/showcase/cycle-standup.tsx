/**
 * Linear cycle standup — `/standup` and prompt-triggerable (`render_standup`).
 *
 * Posts a shadcn summary card for the team's active cycle (progress, scope,
 * done/in-progress) plus a pie chart of issues by status and a bar chart of
 * load per assignee. Linear has no public read, so this needs `LINEAR_API_KEY`
 * (personal API key); without it — or on any error — it falls back to sample
 * data and says so.
 */
import { createElement as h } from "react";
import type { ReactElement } from "react";
import { z } from "zod";
import { defineChannelTool, defineChannelCommand } from "@copilotkit/channels";
import {
  BarChart,
  PieChart,
  DEFAULT_CHART_COLORS,
} from "@copilotkit/channels/charts";
import { GEIST } from "./theme.js";
import { FETCH_TIMEOUT_MS, sampleTag } from "./lib.js";
import type { ShowcaseThread } from "./lib.js";

interface Standup {
  teamName: string;
  cycleName: string;
  dateRange: string;
  total: number;
  completed: number;
  inProgress: number;
  progressPct: number;
  byState: { label: string; value: number }[];
  byAssignee: { label: string; value: number }[];
  live: boolean;
}

const SAMPLE: Standup = {
  teamName: "CopilotKit",
  cycleName: "Cycle 42",
  dateRange: "Jul 21 - Aug 1",
  total: 34,
  completed: 19,
  inProgress: 7,
  progressPct: 56,
  byState: [
    { label: "Done", value: 19 },
    { label: "In Progress", value: 7 },
    { label: "Todo", value: 6 },
    { label: "Backlog", value: 2 },
  ],
  byAssignee: [
    { label: "alem", value: 9 },
    { label: "markus", value: 7 },
    { label: "nathan", value: 6 },
    { label: "hunter", value: 5 },
    { label: "atai", value: 4 },
  ],
  live: false,
};

interface LinearIssue {
  state: { name: string; type: string } | null;
  assignee: { displayName: string } | null;
}
interface LinearResp {
  data?: {
    teams: {
      nodes: {
        name: string;
        activeCycle: {
          name: string | null;
          number: number;
          startsAt: string;
          endsAt: string;
          issues: { nodes: LinearIssue[] };
        } | null;
      }[];
    };
  };
  errors?: { message: string }[];
}

const QUERY = `query($teamKey: String!) {
  teams(filter: { key: { eq: $teamKey } }, first: 1) {
    nodes {
      name
      activeCycle {
        name number startsAt endsAt
        issues(first: 250) { nodes { state { name type } assignee { displayName } } }
      }
    }
  }
}`;

function countBy<T>(
  items: T[],
  key: (t: T) => string,
): { label: string; value: number }[] {
  const m = new Map<string, number>();
  for (const it of items) m.set(key(it), (m.get(key(it)) ?? 0) + 1);
  return [...m.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

let warnedNoKey = false;

async function fetchStandup(): Promise<Standup> {
  const key = process.env["LINEAR_API_KEY"];
  const teamKey = process.env["LINEAR_TEAM_KEY"] ?? "CPK";
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
      body: JSON.stringify({ query: QUERY, variables: { teamKey } }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Linear ${res.status} ${res.statusText}`);
    const json = (await res.json()) as LinearResp;
    if (json.errors?.length)
      throw new Error(json.errors.map((e) => e.message).join("; "));
    const team = json.data?.teams.nodes[0];
    const cycle = team?.activeCycle;
    if (!team || !cycle) throw new Error("no active cycle for team");
    const issues = cycle.issues.nodes;
    const completed = issues.filter(
      (i) => i.state?.type === "completed",
    ).length;
    const inProgress = issues.filter((i) => i.state?.type === "started").length;
    return {
      teamName: team.name,
      cycleName: cycle.name ?? `Cycle ${cycle.number}`,
      dateRange: `${fmtDate(cycle.startsAt)} - ${fmtDate(cycle.endsAt)}`,
      total: issues.length,
      completed,
      inProgress,
      progressPct: issues.length
        ? Math.round((completed / issues.length) * 100)
        : 0,
      byState: countBy(issues, (i) => i.state?.name ?? "No status"),
      byAssignee: countBy(
        issues,
        (i) => i.assignee?.displayName ?? "Unassigned",
      ).slice(0, 6),
      live: true,
    };
  } catch (err) {
    console.warn(
      "[showcase] cycle standup: Linear fetch failed, using sample data —",
      err,
    );
    return SAMPLE;
  }
}

/** A legend entry: a colour swatch (matching the pie slice) + label · count. */
function legendItem(label: string, value: number, color: string): ReactElement {
  return h(
    "div",
    {
      key: label,
      style: {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
      },
    },
    h("div", {
      style: { width: 12, height: 12, borderRadius: 3, backgroundColor: color },
    }),
    h(
      "span",
      { className: "muted", style: { fontSize: 14 } },
      `${label} · ${value}`,
    ),
  );
}

function stat(label: string, value: string): ReactElement {
  return h(
    "div",
    {
      className: "inset",
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 6,
        flexGrow: 1,
        padding: 18,
      },
    },
    h("span", { className: "kpi-label", style: { fontSize: 14 } }, label),
    h("span", { className: "kpi-value", style: { fontSize: 32 } }, value),
  );
}

export function StandupCard(s: Standup): ReactElement {
  return h(
    "div",
    {
      className: "card",
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 16,
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
        `${s.teamName} · ${s.cycleName}`,
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
      `${s.dateRange} · ${s.progressPct}% complete`,
    ),
    h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "row",
          gap: 14,
          width: "100%",
        },
      },
      stat("Scope", String(s.total)),
      stat("Done", String(s.completed)),
      stat("In progress", String(s.inProgress)),
    ),
    // Legend for the status pie chart posted alongside this card (colours match
    // DEFAULT_CHART_COLORS by index, exactly as PieChart assigns them).
    h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 18,
          width: "100%",
        },
      },
      ...s.byState.map((d, i) =>
        legendItem(
          d.label,
          d.value,
          DEFAULT_CHART_COLORS[i % DEFAULT_CHART_COLORS.length]!,
        ),
      ),
    ),
  );
}

export async function renderStandup(thread: ShowcaseThread): Promise<string> {
  const s = await fetchStandup();
  await thread.post(<StandupCard {...s} />, {
    filename: "standup.png",
    title: "Cycle standup",
    width: 760,
    height: 320,
  });
  await thread.post(
    <PieChart
      title={`Issues by status${sampleTag(s.live)}`}
      data={s.byState}
    />,
    { filename: "status.png" },
  );
  if (s.byAssignee.length) {
    await thread.post(
      <BarChart
        title={`Load by assignee${sampleTag(s.live)}`}
        data={s.byAssignee}
      />,
      { filename: "load.png" },
    );
  }
  return s.live
    ? `Posted the ${s.cycleName} standup — ${s.completed}/${s.total} done (${s.progressPct}%).`
    : "Posted the cycle standup (no LINEAR_API_KEY or Linear unreachable, so this is sample data).";
}

export const standupTool = defineChannelTool({
  name: "render_standup",
  description:
    "Post the Linear cycle standup: a summary card (progress, scope, done/in-progress) plus a pie chart of issues by status and a bar chart of load per assignee. Live Linear data when LINEAR_API_KEY is set.",
  parameters: z.object({}),
  async handler(_args, { thread }) {
    return renderStandup(thread);
  },
});

export const standupCommand = defineChannelCommand({
  name: "standup",
  description: "Show the current Linear cycle standup.",
  async handler({ thread }) {
    await renderStandup(thread);
  },
});
