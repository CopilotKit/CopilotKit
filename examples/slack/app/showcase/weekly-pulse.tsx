/**
 * Weekly OSS pulse — `/pulse` and prompt-triggerable (`render_weekly_pulse`).
 *
 * Posts a shadcn KPI card (stars · weekly npm downloads · open issues) plus a
 * downloads line chart and an issues opened-vs-closed bar chart. Data is live
 * from GitHub's public REST API and npm's public downloads API (no token); on
 * failure it falls back to sample data and says so.
 */
import { z } from "zod";
import { defineChannelTool, defineChannelCommand } from "@copilotkit/channels";
import type { ChannelNode } from "@copilotkit/channels";
import { BarChart, LineChart } from "@copilotkit/channels/charts";
import {
  REPO,
  ghFetch,
  fetchJson,
  isoDaysAgo,
  compact,
  sampleTag,
} from "./lib.js";
import type { ShowcaseThread } from "./lib.js";

const NPM_PKG = "@copilotkit/react-core";

interface Pulse {
  stars: number;
  weeklyDownloads: number;
  openIssues: number;
  downloads: { label: string; value: number }[];
  issuesOpened: number;
  issuesClosed: number;
  live: boolean;
}

const SAMPLE: Pulse = {
  stars: 22_400,
  weeklyDownloads: 118_000,
  openIssues: 143,
  downloads: [
    { label: "Mon", value: 14200 },
    { label: "Tue", value: 18900 },
    { label: "Wed", value: 20100 },
    { label: "Thu", value: 19300 },
    { label: "Fri", value: 17800 },
    { label: "Sat", value: 12400 },
    { label: "Sun", value: 15300 },
  ],
  issuesOpened: 31,
  issuesClosed: 24,
  live: false,
};

interface NpmRange {
  downloads: { downloads: number; day: string }[];
}
interface GhRepo {
  stargazers_count: number;
}
interface GhSearch {
  total_count: number;
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

async function fetchPulse(): Promise<Pulse> {
  try {
    const since = isoDaysAgo(7);
    const search = (q: string) =>
      ghFetch<GhSearch>(
        `/search/issues?q=${encodeURIComponent(`repo:${REPO} type:issue ${q}`)}&per_page=1`,
      );
    const [npm, repo, openIssues, opened, closed] = await Promise.all([
      fetchJson<NpmRange>(
        `https://api.npmjs.org/downloads/range/last-week/${NPM_PKG}`,
      ),
      ghFetch<GhRepo>(`/repos/${REPO}`),
      // `repo.open_issues_count` counts issues AND open PRs — search for a true
      // open-issue count instead.
      search("state:open"),
      search(`created:>=${since}`),
      search(`closed:>=${since}`),
    ]);
    if (!npm.downloads?.length) {
      // A 200 with no days is a degenerate response, not a real zero — warn so a
      // live "0 downloads" card is traceable rather than silently confident.
      console.warn(
        `[showcase] weekly pulse: npm returned no download days for ${NPM_PKG}`,
      );
    }
    const downloads = (npm.downloads ?? []).map((d) => ({
      label: WEEKDAY[new Date(d.day).getUTCDay()] ?? d.day,
      value: d.downloads,
    }));
    return {
      stars: repo.stargazers_count,
      weeklyDownloads: downloads.reduce((s, d) => s + d.value, 0),
      openIssues: openIssues.total_count,
      downloads,
      issuesOpened: opened.total_count,
      issuesClosed: closed.total_count,
      live: true,
    };
  } catch (err) {
    console.warn(
      "[showcase] weekly pulse: live fetch failed, using sample data —",
      err,
    );
    return SAMPLE;
  }
}

function kpi(label: string, value: string): ChannelNode {
  return (
    <div className="flex flex-col gap-1.5 grow p-4 bg-brand-surface border border-brand-border rounded-xl">
      <span className="text-sm text-brand-muted">{label}</span>
      <span className="text-[34px] font-bold text-brand-ink">{value}</span>
    </div>
  );
}

export function PulseCard(p: Pulse): ChannelNode {
  return (
    <div className="flex flex-col gap-4 w-full h-full p-7 bg-brand-bg font-brand">
      <div className="flex flex-row items-center justify-between w-full">
        <span className="text-2xl font-bold text-brand-ink">
          Weekly OSS pulse
        </span>
        <span
          className={`text-xs font-semibold rounded-full px-3 py-1 ${p.live ? "bg-brand-mint text-brand-mint-deep" : "bg-[#ffe8c7] text-[#9a5b00]"}`}
        >
          {p.live ? "live · github + npm" : "sample data"}
        </span>
      </div>
      <span className="text-sm text-brand-muted">{`${REPO} · past 7 days`}</span>
      <div className="flex flex-row gap-3.5 w-full">
        {kpi("Stars", compact(p.stars))}
        {kpi("Weekly downloads", compact(p.weeklyDownloads))}
        {kpi("Open issues", compact(p.openIssues))}
      </div>
    </div>
  );
}

export async function renderWeeklyPulse(
  thread: ShowcaseThread,
): Promise<string> {
  const p = await fetchPulse();
  // Lead with a text summary (see renderPrRadar) — captions the images and lets
  // a later turn see this was already handled.
  await thread.post(
    `*Weekly OSS pulse* — ${REPO}, past 7 days${p.live ? "" : " · sample data"}`,
  );
  await thread.post(<PulseCard {...p} />, {
    filename: "pulse.png",
    title: "Weekly OSS pulse",
    width: 760,
    height: 260,
  });
  // LineChart is SVG at its own width/height — size it to the post canvas so it
  // fills the image instead of sitting in a corner.
  await thread.post(
    <LineChart
      title={`${NPM_PKG} downloads / day${sampleTag(p.live)}`}
      data={p.downloads}
      width={760}
      height={360}
    />,
    { filename: "downloads.png", width: 760, height: 360 },
  );
  await thread.post(
    <BarChart
      title={`Issues this week${sampleTag(p.live)}`}
      data={[
        { label: "opened", value: p.issuesOpened },
        { label: "closed", value: p.issuesClosed },
      ]}
    />,
    { filename: "issues.png", width: 760, height: 400 },
  );
  return p.live
    ? `Posted the weekly pulse — ${compact(p.weeklyDownloads)} downloads, ${p.stars} stars.`
    : "Posted the weekly pulse (live data was unreachable, so this is sample data).";
}

export const weeklyPulseTool = defineChannelTool({
  name: "render_weekly_pulse",
  description:
    "Post the weekly OSS pulse: a KPI card (GitHub stars, weekly npm downloads, open issues) plus a downloads line chart and an issues opened-vs-closed bar chart. Live GitHub + npm data.",
  parameters: z.object({}),
  async handler(_args, { thread }) {
    return renderWeeklyPulse(thread);
  },
});

export const pulseCommand = defineChannelCommand({
  name: "pulse",
  description: "Show the weekly OSS pulse (stars, downloads, issues).",
  async handler({ thread }) {
    await renderWeeklyPulse(thread);
  },
});
