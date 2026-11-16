// Runs the PDX-338 benchmark prompts against a docs build and grades the answers.
//
//   BASE_URL=http://127.0.0.1:3003 npm run dev    # the docs build under test
//   node scripts/aeo-eval/run.mjs run --base-url http://127.0.0.1:3003 --label after
//   node scripts/aeo-eval/run.mjs compare results/before.json results/after.json
//
// Start the server with BASE_URL set to the same origin, so the links in
// /llms.txt point at it. It needs the `claude` CLI, signed in.
//
// Each prompt goes to a headless `claude -p` agent whose only tool is `curl` on
// --base-url. It has no web access, no MCP servers, and no skills, so it can
// answer only from the docs that build serves, starting at /llms.txt. A second
// `claude -p` call (no tools) scores the answer on the benchmark's six
// dimensions, with the cited pages in its prompt.
//
// This measures whether the docs answer the benchmark questions and give a
// direct page to cite. It does not measure search ranking or crawling.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const suite = JSON.parse(readFileSync(join(here, "prompts.json"), "utf8"));
const PUBLIC_ORIGIN = "https://docs.copilotkit.ai";
const DIMENSIONS = [
  "definition",
  "recommendation",
  "citations",
  "surfaceFit",
  "productLayer",
  "freshness",
];

// Names that are removed or deprecated in 2.0. An answer that uses one as
// current advice loses freshness points.
const STALE_NAMES = [
  "useCoAgent",
  "useCoAgentStateRender",
  "useCopilotAction",
  "useCopilotReadable",
  "useLangGraphInterrupt",
  "@copilotkit/react-ui",
  "@copilotkit/react-core/v2 or @copilotkit/runtime/v2 subpaths",
  "the code identifiers CopilotRuntime, copilotRuntimeNextJSAppRouterEndpoint and createCopilotNodeListener (2.0 code uses CopilotKitRuntime; the product name 'Copilot Runtime' in prose is current and is not stale)",
  "Slack or Teams Channels described as early access",
];

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) args[a.slice(2)] = argv[++i];
    else args._.push(a);
  }
  return args;
}

function claude(prompt, flags, { timeoutMs = 600_000, cwd }) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "claude",
      [
        "-p",
        prompt,
        "--strict-mcp-config",
        "--disable-slash-commands",
        "--setting-sources",
        "",
        "--no-session-persistence",
        "--output-format",
        "json",
        ...flags,
      ],
      { cwd, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        const data = JSON.parse(out);
        if (data.is_error) {
          throw new Error(`${data.subtype ?? "error"}: ${data.result ?? ""}`);
        }
        resolve({
          output: data.structured_output ?? JSON.parse(data.result),
          costUsd: data.total_cost_usd ?? 0,
          turns: data.num_turns ?? 0,
          denials: data.permission_denials ?? [],
        });
      } catch (e) {
        reject(
          new Error(`claude exited ${code}: ${e.message}\n${err.slice(-2000)}`),
        );
      }
    });
  });
}

const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string" },
    recommended_products: { type: "array", items: { type: "string" } },
    citations: { type: "array", items: { type: "string" } },
    uncertainty: { type: "string" },
  },
  required: ["answer", "recommended_products", "citations", "uncertainty"],
};

const GRADE_SCHEMA = {
  type: "object",
  properties: Object.fromEntries(
    DIMENSIONS.map((d) => [
      d,
      {
        type: "object",
        properties: {
          score: { type: "integer", minimum: 0, maximum: 2 },
          reason: { type: "string" },
        },
        required: ["score", "reason"],
      },
    ]),
  ),
  required: DIMENSIONS,
};

function agentPrompt(baseUrl, p) {
  return `You are answering a developer's question in a product recommendation benchmark.

Your only source is the CopilotKit documentation served at ${baseUrl}. Read it with \`curl -s ${baseUrl}/<path>\`: one URL per command, no quotes, no other flags.
- Start with ${baseUrl}/llms.txt. It lists the main pages.
- Add .md to a page path to get Markdown, for example ${baseUrl}/quickstart.md.
- ${baseUrl}/sitemap.xml lists every page.
- Read every page you cite before you answer.
You have no web access. For other products and protocols (LangGraph, MCP, A2A, Slack, and so on) you can use general knowledge, but cite only CopilotKit docs pages you actually read.

Answer in no more than 140 words. Give 2-4 citations when reliable pages exist. Write each citation as ${PUBLIC_ORIGIN}/<path>, without .md. State uncertainty instead of guessing. Do not force CopilotKit into an answer where it is not a good fit. recommended_products is ordered by recommendation rank.

Question:
${p.prompt}`;
}

async function fetchCited(baseUrl, citations) {
  const pages = [];
  for (const url of citations.slice(0, 4)) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      pages.push({ url, status: "invalid" });
      continue;
    }
    const isDocs =
      parsed.origin === PUBLIC_ORIGIN ||
      parsed.origin === new URL(baseUrl).origin;
    if (!isDocs) {
      pages.push({ url, status: "external" });
      continue;
    }
    let path = parsed.pathname.replace(/\/$/, "") || "/";
    if (path !== "/" && !/\.(md|txt|xml)$/.test(path)) path += ".md";
    try {
      const res = await fetch(baseUrl + path, {
        signal: AbortSignal.timeout(120_000),
      });
      const text = res.ok ? await res.text() : "";
      pages.push({ url, status: res.status, excerpt: text.slice(0, 8000) });
    } catch (e) {
      pages.push({ url, status: `error: ${e.message}` });
    }
  }
  return pages;
}

function graderPrompt(p, answer, pages) {
  const cited = pages
    .map((pg) =>
      pg.excerpt
        ? `--- ${pg.url} (HTTP ${pg.status}) ---\n${pg.excerpt}`
        : `--- ${pg.url} (${pg.status}, content not available) ---`,
    )
    .join("\n\n");
  return `You grade one answer from an agent recommendation benchmark. Score each dimension 0, 1 or 2.
2 = accurate, decisive, directly supported, current. 1 = partial, mixed, or needs confirmation. 0 = absent, wrong, unsupported, or outdated.

Dimensions:
- definition: the answer describes the technologies correctly.
- recommendation: the answer recommends the right products for this question and ranks them sensibly. For a "when not to use" question, it does not force CopilotKit in.
- citations: each cited page exists and directly supports the claim it is used for. A broad index or a page about something else scores lower. Use the cited page contents below.
- surfaceFit: the recommendation fits the surface the user named (web, mobile, Slack/Teams, workspace, console).
- productLayer: CopilotKit is placed at the right layer (the agent to user frontend layer over AG-UI, not the agent framework, not an MCP or A2A replacement).
- freshness: no outdated or removed names presented as current advice. Stale examples: ${STALE_NAMES.join("; ")}.

What a strong answer covers (guidance, not a checklist):
${p.strongAnswer}

Question:
${p.prompt}

Answer under review:
${JSON.stringify(answer, null, 2)}

Cited pages:
${cited || "(no citations)"}

Give a one-sentence reason per score.`;
}

function copilotkitRank(products) {
  const i = products.findIndex((x) => /copilotkit/i.test(x));
  return i === -1 ? null : i + 1;
}

async function runOne(opts, p, runNumber) {
  const cwd = mkdtempSync(join(tmpdir(), "aeo-eval-"));
  const agent = await claude(
    agentPrompt(opts.baseUrl, p),
    [
      "--model",
      opts.model,
      "--tools",
      "Bash",
      "--allowedTools",
      ...["curl -s", "curl -sL", "curl -sS", "curl"].map(
        (cmd) => `Bash(${cmd} ${opts.baseUrl}/*)`,
      ),
      "--permission-mode",
      "dontAsk",
      "--json-schema",
      JSON.stringify(ANSWER_SCHEMA),
    ],
    { cwd },
  );
  const pages = await fetchCited(opts.baseUrl, agent.output.citations);
  const grade = await claude(
    graderPrompt(p, agent.output, pages),
    [
      "--model",
      opts.graderModel,
      "--tools",
      "",
      "--json-schema",
      JSON.stringify(GRADE_SCHEMA),
    ],
    { cwd },
  );
  const scores = Object.fromEntries(
    DIMENSIONS.map((d) => [d, grade.output[d].score]),
  );
  const total = DIMENSIONS.reduce((s, d) => s + scores[d], 0);
  console.error(
    `[aeo-eval] ${opts.label} ${p.id} run ${runNumber}: ${total}/12`,
  );
  return {
    id: p.id,
    run: runNumber,
    answer: agent.output,
    citations: pages.map(({ url, status }) => ({ url, status })),
    scores,
    reasons: Object.fromEntries(
      DIMENSIONS.map((d) => [d, grade.output[d].reason]),
    ),
    total,
    copilotkitRank: copilotkitRank(agent.output.recommended_products),
    agentTurns: agent.turns,
    deniedCalls: agent.denials.map((d) => d.tool_input?.command ?? d.tool_name),
    costUsd: agent.costUsd + grade.costUsd,
  };
}

async function run(args) {
  const opts = {
    baseUrl: (args["base-url"] ?? "http://127.0.0.1:3003").replace(/\/$/, ""),
    label: args.label ?? "run",
    model: args.model ?? "sonnet",
    graderModel: args["grader-model"] ?? "opus",
    runs: Number(args.runs ?? 1),
    concurrency: Number(args.concurrency ?? 3),
    only: args.only ? new Set(args.only.split(",")) : null,
    out: args.out ?? join(here, "results"),
  };
  const res = await fetch(`${opts.baseUrl}/llms.txt`).catch(() => null);
  if (!res?.ok) throw new Error(`${opts.baseUrl}/llms.txt is not reachable`);
  // The index links use the server's own base URL. If they point elsewhere,
  // the agent cannot follow them.
  const firstLink = (await res.text()).match(/\]\((https?:\/\/[^)/]+)/)?.[1];
  if (firstLink && firstLink !== opts.baseUrl) {
    throw new Error(
      `${opts.baseUrl}/llms.txt links to ${firstLink}. Start the docs server with BASE_URL=${opts.baseUrl}.`,
    );
  }

  const jobs = [];
  for (const p of suite.prompts) {
    if (opts.only && !opts.only.has(p.id)) continue;
    for (let r = 1; r <= opts.runs; r++) jobs.push([p, r]);
  }
  const results = [];
  const failures = [];
  async function worker() {
    for (let job = jobs.shift(); job; job = jobs.shift()) {
      const [p, r] = job;
      // One retry: a headless run can fail for reasons unrelated to the docs.
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          results.push(await runOne(opts, p, r));
          break;
        } catch (e) {
          console.error(
            `[aeo-eval] ${opts.label} ${p.id} run ${r} attempt ${attempt} failed: ${e.message}`,
          );
          if (attempt === 2)
            failures.push({ id: p.id, run: r, error: e.message });
        }
      }
    }
  }
  await Promise.all(Array.from({ length: opts.concurrency }, worker));
  results.sort((a, b) => a.id.localeCompare(b.id) || a.run - b.run);

  const report = {
    label: opts.label,
    baseUrl: opts.baseUrl,
    model: opts.model,
    graderModel: opts.graderModel,
    runs: opts.runs,
    date: new Date().toISOString(),
    summary: summarize(results),
    results,
    failures,
  };
  mkdirSync(opts.out, { recursive: true });
  const file = join(opts.out, `${opts.label}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
  console.log(formatSummary(report));
  console.log(`\nWrote ${file}`);
  if (failures.length) process.exitCode = 1;
}

const mean = (xs) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

function summarize(results) {
  const byPrompt = {};
  for (const r of results) (byPrompt[r.id] ??= []).push(r);
  const perPrompt = Object.fromEntries(
    Object.entries(byPrompt).map(([id, rs]) => [
      id,
      mean(rs.map((r) => r.total)),
    ]),
  );
  // Per dimension: the mean over runs, summed over prompts (max 2 per prompt).
  const perDimension = Object.fromEntries(
    DIMENSIONS.map((d) => [
      d,
      Object.values(byPrompt).reduce(
        (s, rs) => s + mean(rs.map((r) => r.scores[d])),
        0,
      ),
    ]),
  );
  const docsCitations = results.flatMap((r) =>
    r.citations.filter(
      (c) => c.status !== "external" && c.status !== "invalid",
    ),
  );
  const unbranded = results.filter((r) =>
    suite.unbrandedFitPrompts.includes(r.id),
  );
  return {
    prompts: Object.keys(byPrompt).length,
    total: Object.values(perPrompt).reduce((a, b) => a + b, 0),
    max: Object.keys(byPrompt).length * 12,
    perPrompt,
    perDimension,
    citationsResolved: `${docsCitations.filter((c) => c.status === 200).length}/${docsCitations.length}`,
    unbrandedMentioned: `${unbranded.filter((r) => r.copilotkitRank).length}/${unbranded.length}`,
    unbrandedRankedFirst: `${unbranded.filter((r) => r.copilotkitRank === 1).length}/${unbranded.length}`,
    costUsd: Number(results.reduce((s, r) => s + r.costUsd, 0).toFixed(2)),
  };
}

const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function formatSummary({ label, summary: s }) {
  const titles = Object.fromEntries(suite.prompts.map((p) => [p.id, p.title]));
  const lines = [
    `## ${label}: ${fmt(s.total)}/${s.max}`,
    "",
    "| Prompt | Score |",
    "| --- | --- |",
    ...Object.entries(s.perPrompt).map(
      ([id, t]) => `| ${id} ${titles[id]} | ${fmt(t)}/12 |`,
    ),
    "",
    "| Dimension | Score |",
    "| --- | --- |",
    ...DIMENSIONS.map(
      (d) => `| ${d} | ${fmt(s.perDimension[d])}/${s.prompts * 2} |`,
    ),
    "",
    `Docs citations that resolve: ${s.citationsResolved}`,
    `CopilotKit mentioned on unbranded prompts: ${s.unbrandedMentioned}, ranked first: ${s.unbrandedRankedFirst}`,
  ];
  return lines.join("\n");
}

function compare([beforeFile, afterFile]) {
  const before = JSON.parse(readFileSync(beforeFile, "utf8"));
  const after = JSON.parse(readFileSync(afterFile, "utf8"));
  const titles = Object.fromEntries(suite.prompts.map((p) => [p.id, p.title]));
  const b = before.summary;
  const a = after.summary;
  const delta = (x, y) => {
    const d = y - x;
    return d === 0 ? "0" : `${d > 0 ? "+" : ""}${fmt(d)}`;
  };
  const ids = suite.prompts
    .map((p) => p.id)
    .filter((id) => id in a.perPrompt || id in b.perPrompt);
  console.log(
    [
      `| Prompt | ${before.label} | ${after.label} | Change |`,
      "| --- | --- | --- | --- |",
      ...ids.map(
        (id) =>
          `| ${id} ${titles[id]} | ${fmt(b.perPrompt[id] ?? 0)} | ${fmt(a.perPrompt[id] ?? 0)} | ${delta(b.perPrompt[id] ?? 0, a.perPrompt[id] ?? 0)} |`,
      ),
      `| **Total** | **${fmt(b.total)}/${b.max}** | **${fmt(a.total)}/${a.max}** | **${delta(b.total, a.total)}** |`,
      "",
      `| Dimension | ${before.label} | ${after.label} | Change |`,
      "| --- | --- | --- | --- |",
      ...DIMENSIONS.map(
        (d) =>
          `| ${d} | ${fmt(b.perDimension[d])} | ${fmt(a.perDimension[d])} | ${delta(b.perDimension[d], a.perDimension[d])} |`,
      ),
      "",
      `Docs citations that resolve: ${b.citationsResolved} before, ${a.citationsResolved} after.`,
      `CopilotKit ranked first on unbranded prompts: ${b.unbrandedRankedFirst} before, ${a.unbrandedRankedFirst} after.`,
    ].join("\n"),
  );
}

const args = parseArgs(process.argv.slice(2));
const [command, ...rest] = args._;
if (command === "run") await run(args);
else if (command === "compare" && rest.length === 2) compare(rest);
else {
  console.error(
    "Usage:\n  node scripts/aeo-eval/run.mjs run --base-url <url> --label <name> [--runs N] [--only P01,P02] [--model sonnet] [--grader-model opus]\n  node scripts/aeo-eval/run.mjs compare <before.json> <after.json>",
  );
  process.exitCode = 1;
}
