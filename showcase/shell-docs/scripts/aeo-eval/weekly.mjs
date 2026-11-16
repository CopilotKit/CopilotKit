// Turns this week's two `web` reports (normal and blind) into the weekly AEO
// report, with the change since last week.
//
//   node scripts/aeo-eval/weekly.mjs --normal results/weekly-normal.json \
//     --blind results/weekly-blind.json --out results/weekly
//
// It always writes report.md and slack.txt to --out. With --publish it also:
// - reads last week's numbers from the "AEO weekly report" issue (the data
//   block at the end of its body), so the history needs no storage of its own
// - posts the report as a comment on that issue, and puts it in the issue body
//   for next week (it creates the issue on the first run)
// - posts the short version to Slack when SLACK_WEBHOOK is set
// - appends the report to the job summary when GITHUB_STEP_SUMMARY is set
//
// --publish needs GITHUB_TOKEN and GITHUB_REPOSITORY. The exit code is 1 when a
// report file is missing, so a crashed eval fails the job after the report.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const suite = JSON.parse(readFileSync(join(here, "prompts.json"), "utf8"));
const ISSUE_TITLE = "AEO weekly report";
const DATA_MARK = "aeo-weekly-data";
// Changes smaller than these are within the run-to-run spread.
const TOTAL_PTS = 10;
const PROMPT_RUNS = 2;
const MODES = [
  ["normal", "Normal"],
  ["blind", "Blind"],
];

const isCopilotKit = (s) => /copilot\s*-?\s*kit/i.test(s ?? "");
const pct = (n, d) => (d ? Math.round((100 * n) / d) : 0);
const titles = Object.fromEntries(
  [...suite.prompts, ...suite.webPrompts].map((p) => [p.id, p.title]),
);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].slice(2);
    if (argv[i + 1] === undefined || argv[i + 1].startsWith("--"))
      args[key] = true;
    else args[key] = argv[++i];
  }
  return args;
}

function readReport(file) {
  if (!file || !existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}

const counts = (x) => ({
  runs: x.runs,
  recommended: x.recommended,
  first: x.first,
});

// The numbers kept for next week's comparison.
function dataOf(report) {
  const s = report.summary;
  return {
    overall: { ...counts(s.overall), fromMemory: s.overall.fromMemory },
    perPrompt: Object.fromEntries(
      Object.entries(s.perPrompt).map(([id, x]) => [id, counts(x)]),
    ),
    failures: report.failures.length,
    costUsd: s.costUsd,
  };
}

// The most common first pick when CopilotKit was not first.
function topRival(report, id) {
  const picks = new Map();
  for (const r of report.results) {
    const top = r.id === id ? r.answer.recommended_products[0] : null;
    if (!top || isCopilotKit(top)) continue;
    // Model output goes into Markdown: drop the characters that can break a
    // table cell or ping someone.
    const name = top
      .replace(/\s*\(.*\)\s*$/, "")
      .replace(/[|@<>]/g, "")
      .trim();
    picks.set(name, (picks.get(name) ?? 0) + 1);
  }
  const best = [...picks.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? `${best[0]} (${best[1]})` : "";
}

// "+4 pts", "-2 pts", or "0 pts".
function change(now, before) {
  const d = now - before;
  return `${d > 0 ? "+" : ""}${d} pts`;
}

const rate = (x, key) => `${pct(x[key], x.runs)}% (${x[key]}/${x.runs})`;

// The changes worth a look: a total moved by TOTAL_PTS or more, or one
// prompt moved by PROMPT_RUNS runs or more.
function changes(now, previous) {
  const out = [];
  for (const [mode, name] of MODES) {
    const a = now[mode];
    const b = previous?.modes?.[mode];
    if (!a || !b) continue;
    for (const [key, what] of [
      ["recommended", "recommended"],
      ["first", "ranked first"],
    ]) {
      const d =
        pct(a.overall[key], a.overall.runs) -
        pct(b.overall[key], b.overall.runs);
      if (Math.abs(d) >= TOTAL_PTS)
        out.push(`${name}, all prompts: ${what} ${d > 0 ? "+" : ""}${d} pts.`);
      for (const [id, x] of Object.entries(a.perPrompt)) {
        const y = b.perPrompt[id];
        if (!y || Math.abs(x[key] - y[key]) < PROMPT_RUNS) continue;
        out.push(
          `${name}, ${id} ${titles[id] ?? ""}: ${what} ${y[key]}/${y.runs} to ${x[key]}/${x.runs}.`,
        );
      }
    }
  }
  return out;
}

function buildReport({ reports, data, previous, runUrl }) {
  const date = new Date().toISOString().slice(0, 10);
  const any = reports.blind ?? reports.normal;
  const lines = [
    `## AEO weekly report, ${date}`,
    "",
    `How often an agent that researches the web recommends CopilotKit, on ${Object.keys(any.summary.perPrompt).length} prompts that never name it. Production search and docs, ${any.model[0].toUpperCase()}${any.model.slice(1)} agent, ${any.runs} runs per prompt.`,
    "",
    "- Normal: the agent can use what the model already knows.",
    "- Blind: the agent can name a product only after the web showed it. This measures what the web and the docs earn.",
    "",
    "| Mode | Recommended | Ranked first |",
    "| --- | --- | --- |",
  ];
  for (const [mode, name] of MODES) {
    const x = data.modes[mode]?.overall;
    const b = previous?.modes?.[mode]?.overall;
    if (!x) {
      lines.push(`| ${name} | no report | no report |`);
      continue;
    }
    lines.push(
      `| ${name} | ${rate(x, "recommended")}${b ? `, ${change(pct(x.recommended, x.runs), pct(b.recommended, b.runs))}` : ""} | ${rate(x, "first")}${b ? `, ${change(pct(x.first, x.runs), pct(b.first, b.runs))}` : ""} |`,
    );
  }
  lines.push(
    "",
    previous
      ? `Changes since ${previous.date}, compared with last week's report:`
      : "This is the first report, so there is no change to show.",
  );
  const found = previous ? changes(data.modes, previous) : [];
  if (previous) {
    lines.push("");
    if (found.length) lines.push(...found.map((c) => `- ${c}`));
    else
      lines.push(
        `- No total moved by ${TOTAL_PTS} pts or more, and no prompt moved by ${PROMPT_RUNS} runs or more. Smaller changes are within the run-to-run spread.`,
      );
  }

  const ids = Object.keys(any.summary.perPrompt);
  const cell = (mode, id) => {
    const x = data.modes[mode]?.perPrompt[id];
    return x ? `${x.recommended}/${x.runs} | ${x.first}/${x.runs}` : "- | -";
  };
  lines.push(
    "",
    "### Per prompt",
    "",
    "| Prompt | Normal: recommended | Normal: first | Blind: recommended | Blind: first | Top pick when not CopilotKit (blind) |",
    "| --- | --- | --- | --- | --- | --- |",
    ...ids.map(
      (id) =>
        `| ${id} ${titles[id] ?? ""} | ${cell("normal", id)} | ${cell("blind", id)} | ${reports.blind ? topRival(reports.blind, id) || "-" : "-"} |`,
    ),
  );

  const notes = [];
  for (const [mode, name] of MODES) {
    const d = data.modes[mode];
    if (!d)
      notes.push(`${name}: the eval produced no report. Read the job log.`);
    else if (d.failures)
      notes.push(
        `${name}: ${d.failures} runs failed twice and are not counted.`,
      );
  }
  const cost = MODES.reduce((s, [m]) => s + (data.modes[m]?.costUsd ?? 0), 0);
  notes.push(`Cost: $${cost.toFixed(2)}.`);
  if (runUrl)
    notes.push(
      `Charts and raw results: [workflow run](${runUrl}), artifact \`aeo-weekly-report\`.`,
    );
  lines.push("", ...notes.map((n) => `- ${n}`));
  lines.push("", `<!-- ${DATA_MARK} ${JSON.stringify(data)} -->`);
  return { markdown: lines.join("\n"), found };
}

function buildSlack({ data, previous, found, links }) {
  const part = (mode, name) => {
    const x = data.modes[mode]?.overall;
    if (!x) return `${name}: no report`;
    const b = previous?.modes?.[mode]?.overall;
    const r = pct(x.recommended, x.runs);
    const f = pct(x.first, x.runs);
    return `${name}: recommended ${r}%${b ? ` (${change(r, pct(b.recommended, b.runs))})` : ""}, first ${f}%${b ? ` (${change(f, pct(b.first, b.runs))})` : ""}`;
  };
  const weakest = Object.entries(
    (data.modes.blind ?? data.modes.normal)?.perPrompt ?? {},
  )
    .sort(
      (a, b) => a[1].recommended - b[1].recommended || a[1].first - b[1].first,
    )
    .slice(0, 3)
    .map(([id, x]) => `${id} ${titles[id] ?? ""} ${x.recommended}/${x.runs}`);
  return [
    `*AEO weekly report*: how often a web-researching agent recommends CopilotKit`,
    `${part("blind", "Blind")}. ${part("normal", "Normal")}.`,
    previous
      ? found.length
        ? `Changes to look at:\n${found.map((c) => `- ${c}`).join("\n")}`
        : "No change outside the run-to-run spread."
      : "First report, so no change to show.",
    `Weakest prompts (recommended, blind): ${weakest.join(", ")}`,
    links,
  ].join("\n");
}

async function github(path, init = {}) {
  const res = await fetch(
    `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${path}`,
    {
      ...init,
      headers: {
        authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "content-type": "application/json",
      },
    },
  );
  if (!res.ok)
    throw new Error(
      `GitHub ${init.method ?? "GET"} ${path}: ${res.status} ${await res.text()}`,
    );
  return res.json();
}

async function findIssue() {
  const issues = await github(
    `/issues?state=open&creator=${encodeURIComponent("github-actions[bot]")}&per_page=100`,
  );
  return issues.find((i) => i.title === ISSUE_TITLE && !i.pull_request) ?? null;
}

function previousData(issue) {
  const match = issue?.body?.match(new RegExp(`<!-- ${DATA_MARK} (.*) -->`));
  return match ? JSON.parse(match[1]) : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = args.out ?? join(here, "results", "weekly");
  const reports = {
    normal: readReport(args.normal),
    blind: readReport(args.blind),
  };
  if (!reports.normal && !reports.blind) {
    console.error(
      "No report to summarize: both --normal and --blind are missing.",
    );
    process.exit(1);
  }
  const data = {
    date: new Date().toISOString().slice(0, 10),
    modes: Object.fromEntries(
      MODES.filter(([m]) => reports[m]).map(([m]) => [m, dataOf(reports[m])]),
    ),
  };
  const runUrl = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null;

  const issue = args.publish ? await findIssue() : null;
  const previous = args.previous
    ? JSON.parse(readFileSync(args.previous, "utf8"))
    : previousData(issue);
  const { markdown, found } = buildReport({ reports, data, previous, runUrl });

  let issueUrl = issue?.html_url ?? null;
  if (args.publish) {
    let target = issue;
    if (target) {
      await github(`/issues/${target.number}`, {
        method: "PATCH",
        body: JSON.stringify({ body: markdown }),
      });
    } else {
      target = await github("/issues", {
        method: "POST",
        body: JSON.stringify({ title: ISSUE_TITLE, body: markdown }),
      });
    }
    // The body keeps the latest report. The comments keep the history.
    const comment = await github(`/issues/${target.number}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: markdown }),
    });
    issueUrl = comment.html_url;
  }

  const links = [
    issueUrl && `<${issueUrl}|Full report>`,
    runUrl && `<${runUrl}|Charts>`,
  ]
    .filter(Boolean)
    .join(" | ");
  const slack = buildSlack({ data, previous, found, links });

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "report.md"), markdown + "\n");
  writeFileSync(join(out, "slack.txt"), slack + "\n");
  console.log(markdown);
  console.log(`\n--- Slack ---\n${slack}`);

  if (args.publish && process.env.SLACK_WEBHOOK) {
    const res = await fetch(process.env.SLACK_WEBHOOK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: slack }),
    });
    if (!res.ok) throw new Error(`Slack: ${res.status} ${await res.text()}`);
  } else if (args.publish) {
    console.error(
      "::warning::SLACK_WEBHOOK is not set, so Slack got no report.",
    );
  }
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + "\n");

  if (!reports.normal || !reports.blind) process.exitCode = 1;
}

await main();
