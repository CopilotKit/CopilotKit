/**
 * PR review radar — `/prs` and prompt-triggerable (`render_pr_radar`).
 *
 * Posts a shadcn-styled card of the open PRs most in need of review (oldest
 * first, colour-coded by age) plus a bar chart of PRs bucketed by age. Data is
 * live from GitHub's public REST API (no token needed); on any fetch error it
 * falls back to sample data and says so on the card.
 *
 * Both triggers call one `renderPrRadar(thread)` fn: the `defineChannelTool`
 * is the prompt path (the agent calls it), the `defineChannelCommand` is the
 * deterministic slash path.
 */
import { createElement as h } from "react";
import type { ReactElement } from "react";
import { z } from "zod";
import { defineChannelTool, defineChannelCommand } from "@copilotkit/channels";
import { BarChart } from "@copilotkit/channels/charts";
import { GEIST } from "./theme.js";
import { REPO, ghFetch, ageInDays, sampleTag } from "./lib.js";
import type { ShowcaseThread } from "./lib.js";

interface Pr {
  number: number;
  title: string;
  author: string;
  ageDays: number;
  draft: boolean;
}

interface GhPr {
  number: number;
  title: string;
  draft?: boolean;
  created_at: string;
  user: { login: string } | null;
}

const SAMPLE: Pr[] = [
  {
    number: 6146,
    title: "feat(channels): post JSX as images via Takumi",
    author: "AlemTuzlak",
    ageDays: 1,
    draft: false,
  },
  {
    number: 6112,
    title: "fix(runtime): stream cancellation on client disconnect",
    author: "octocat",
    ageDays: 4,
    draft: false,
  },
  {
    number: 6098,
    title: "docs(channels): adapter capability matrix",
    author: "hunterbecton",
    ageDays: 6,
    draft: false,
  },
  {
    number: 6071,
    title: "refactor(core): collapse duplicate tool registries",
    author: "mme",
    ageDays: 9,
    draft: false,
  },
  {
    number: 6055,
    title: "feat(angular): standalone CopilotChat component",
    author: "nathanwilk7",
    ageDays: 12,
    draft: false,
  },
];

/** Live open PRs awaiting review (oldest first), or sample data on failure. */
async function fetchPrRadar(): Promise<{ prs: Pr[]; live: boolean }> {
  try {
    const raw = await ghFetch<GhPr[]>(
      `/repos/${REPO}/pulls?state=open&per_page=100&sort=created&direction=asc`,
    );
    const prs = raw
      .filter((p) => !p.draft)
      .map((p) => ({
        number: p.number,
        title: p.title,
        author: p.user?.login ?? "unknown",
        ageDays: ageInDays(p.created_at),
        draft: false,
      }));
    // Empty is a valid live result (no open PRs) — don't mask it with samples.
    return { prs, live: true };
  } catch (err) {
    console.warn(
      "[showcase] PR radar: GitHub fetch failed, using sample data —",
      err,
    );
    return { prs: SAMPLE, live: false };
  }
}

/** green ≤3d · amber ≤7d · red >7d */
function ageBadge(days: number): { cls: string; text: string } {
  const text = days === 0 ? "today" : `${days}d`;
  if (days <= 3) return { cls: "badge badge-green", text };
  if (days <= 7) return { cls: "badge badge-amber", text };
  return { cls: "badge badge-red", text };
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function prRow(pr: Pr): ReactElement {
  const badge = ageBadge(pr.ageDays);
  return h(
    "div",
    {
      key: pr.number,
      style: {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        width: "100%",
      },
    },
    h(
      "span",
      { className: "muted", style: { fontSize: 15, width: 56 } },
      `#${pr.number}`,
    ),
    h(
      "span",
      { className: "fg", style: { fontSize: 15, flexGrow: 1 } },
      truncate(pr.title, 58),
    ),
    h(
      "span",
      {
        className: "muted",
        style: { fontSize: 14, width: 120, textAlign: "right" },
      },
      `@${truncate(pr.author, 12)}`,
    ),
    h(
      "span",
      {
        className: badge.cls,
        style: {
          fontSize: 13,
          padding: "3px 10px",
          width: 56,
          textAlign: "center",
        },
      },
      badge.text,
    ),
  );
}

export interface PrRadarCardProps {
  prs: Pr[];
  live: boolean;
}

/** Presentational — arbitrary app JSX rendered to an image via Takumi. */
export function PrRadarCard({ prs, live }: PrRadarCardProps): ReactElement {
  const shown = prs.slice(0, 8);
  return h(
    "div",
    {
      className: "card",
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 14,
        width: "100%",
        height: "100%",
        padding: 28,
        fontFamily: GEIST,
      },
    },
    // header
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
        "PR review radar",
      ),
      h(
        "span",
        {
          className: live ? "badge badge-green" : "badge badge-amber",
          style: { fontSize: 12, padding: "4px 12px" },
        },
        live ? "live · github" : "sample data",
      ),
    ),
    h(
      "span",
      { className: "muted", style: { fontSize: 14 } },
      `${REPO} · ${prs.length} open · oldest first`,
    ),
    h("div", { className: "divider", style: { height: 1, width: "100%" } }),
    // rows (or empty state)
    shown.length
      ? h(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
              gap: 12,
              width: "100%",
            },
          },
          ...shown.map(prRow),
        )
      : h(
          "span",
          { className: "muted", style: { fontSize: 16 } },
          "No open PRs awaiting review — all clear.",
        ),
  );
}

/** Bucket PRs by age for the bar chart. */
function byAgeBucket(prs: Pr[]): { label: string; value: number }[] {
  // ASCII labels only — Takumi's built-in Latin font has no en-dash / ≤ glyph.
  const buckets = [
    { label: "0-1d", test: (d: number) => d <= 1 },
    { label: "2-3d", test: (d: number) => d >= 2 && d <= 3 },
    { label: "4-7d", test: (d: number) => d >= 4 && d <= 7 },
    { label: ">7d", test: (d: number) => d > 7 },
  ];
  return buckets.map((b) => ({
    label: b.label,
    value: prs.filter((p) => b.test(p.ageDays)).length,
  }));
}

/** Shared render path — used by BOTH the tool and the slash command. */
export async function renderPrRadar(thread: ShowcaseThread): Promise<string> {
  const { prs, live } = await fetchPrRadar();
  const height = 150 + Math.max(1, Math.min(prs.length, 8)) * 40;
  await thread.post(<PrRadarCard prs={prs} live={live} />, {
    filename: "pr-radar.png",
    title: "PR review radar",
    width: 760,
    height,
  });
  if (prs.length) {
    await thread.post(
      <BarChart
        title={`Open PRs by age${sampleTag(live)}`}
        data={byAgeBucket(prs)}
      />,
      {
        filename: "pr-age.png",
      },
    );
  }
  return live
    ? `Posted the PR radar — ${prs.length} open PR(s) on ${REPO}.`
    : "Posted the PR radar (GitHub was unreachable, so this is sample data).";
}

export const prRadarTool = defineChannelTool({
  name: "render_pr_radar",
  description:
    "Post the PR review radar: a card of open pull requests most in need of review (oldest first, colour-coded by age) plus a bar chart of PRs by age. Live GitHub data.",
  parameters: z.object({}),
  async handler(_args, { thread }) {
    return renderPrRadar(thread);
  },
});

export const prsCommand = defineChannelCommand({
  name: "prs",
  description: "Show the PR review radar (open PRs needing review).",
  async handler({ thread }) {
    await renderPrRadar(thread);
  },
});
