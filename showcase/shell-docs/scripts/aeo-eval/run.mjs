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
//
// The `web` command measures how often an agent that researches the open web
// recommends CopilotKit. It runs the unbranded prompts (they never name
// CopilotKit) with two tools: the live WebSearch, and a `fetch` tool from
// fetch-server.mjs that reads any URL. Nothing in the prompt or the tools
// names CopilotKit. Without --docs-base-url, every fetch goes to production.
// With it, a fetch of a docs.copilotkit.ai page is served from that docs
// build instead, so search runs on production and the docs content comes from
// the branch. No grader runs: the counts come from the agent's own ranking.
//
//   node scripts/aeo-eval/run.mjs web --label prod --runs 5
//   node scripts/aeo-eval/run.mjs web --label branch --runs 5 --docs-base-url http://127.0.0.1:3003
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
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
    if (!a.startsWith("--")) args._.push(a);
    // A flag with no value (`--blind`) is true.
    else if (argv[i + 1] === undefined || argv[i + 1].startsWith("--"))
      args[a.slice(2)] = true;
    else args[a.slice(2)] = argv[++i];
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
        // stream-json lists every tool call; its last line is the same
        // result object that "json" prints.
        "--output-format",
        "stream-json",
        "--verbose",
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
        const events = out
          .split("\n")
          .filter((line) => line.startsWith("{"))
          .map((line) => JSON.parse(line));
        const data = events.findLast((e) => e.type === "result");
        if (!data) throw new Error("no result event");
        const resultText = new Map(
          events
            .filter((e) => e.type === "user")
            .flatMap((e) => e.message?.content ?? [])
            .filter((block) => block.type === "tool_result")
            .map((block) => [
              block.tool_use_id,
              typeof block.content === "string"
                ? block.content
                : (block.content ?? []).map((c) => c.text ?? "").join("\n"),
            ]),
        );
        // In call order, each with the text the tool returned.
        const toolCalls = events
          .filter((e) => e.type === "assistant")
          .flatMap((e) => e.message?.content ?? [])
          .filter((block) => block.type === "tool_use")
          .map((block) => ({
            name: block.name,
            input: block.input,
            resultText: resultText.get(block.id) ?? "",
          }));
        if (data.is_error) {
          throw new Error(`${data.subtype ?? "error"}: ${data.result ?? ""}`);
        }
        resolve({
          output: data.structured_output ?? JSON.parse(data.result),
          costUsd: data.total_cost_usd ?? 0,
          turns: data.num_turns ?? 0,
          denials: data.permission_denials ?? [],
          toolCalls,
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

async function checkDocsServer(baseUrl) {
  const res = await fetch(`${baseUrl}/llms.txt`).catch(() => null);
  if (!res?.ok) throw new Error(`${baseUrl}/llms.txt is not reachable`);
  // The index links use the server's own base URL. If they point elsewhere,
  // the agent cannot follow them.
  const firstLink = (await res.text()).match(/\]\((https?:\/\/[^)/]+)/)?.[1];
  if (firstLink && firstLink !== baseUrl) {
    throw new Error(
      `${baseUrl}/llms.txt links to ${firstLink}. Start the docs server with BASE_URL=${baseUrl}.`,
    );
  }
}

// Runs each prompt opts.runs times, opts.concurrency at a time.
async function runPool(opts, prompts, runJob) {
  const jobs = prompts.flatMap((p) =>
    Array.from({ length: opts.runs }, (_, i) => [p, i + 1]),
  );
  const results = [];
  const failures = [];
  async function worker() {
    for (let job = jobs.shift(); job; job = jobs.shift()) {
      const [p, r] = job;
      // One retry: a headless run can fail for reasons unrelated to the docs.
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          results.push(await runJob(opts, p, r));
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
  return { results, failures };
}

function writeReport(opts, report, text) {
  mkdirSync(opts.out, { recursive: true });
  const file = join(opts.out, `${opts.label}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
  console.log(text);
  console.log(`\nWrote ${file}`);
  if (report.failures.length) process.exitCode = 1;
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
  await checkDocsServer(opts.baseUrl);
  const prompts = suite.prompts.filter(
    (p) => !opts.only || opts.only.has(p.id),
  );
  const { results, failures } = await runPool(opts, prompts, runOne);

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
  writeReport(opts, report, formatSummary(report));
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
  if ((before.mode === "web") !== (after.mode === "web")) {
    throw new Error("Compare two `run` reports or two `web` reports.");
  }
  if (before.mode === "web") return compareWeb(before, after);
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

// ---- web mode -------------------------------------------------------------

const DOCS_HOST = new URL(PUBLIC_ORIGIN).hostname;
const isCopilotKit = (s) => /copilot\s*-?\s*kit/i.test(s);

// With `blind`, the agent may name a product only after the web showed it,
// so what it recommends comes from the web and not from its own memory.
const BLIND_RULES = `
Work only from what you find on the web, not from what you already know:
- Your first searches describe the need in the question's own terms. They name no product, library, or company.
- Name a product in a search query, or fetch its site, only after it appeared in an earlier search result or page.
- Recommend only products that appeared in your search results or in pages you read.
`;

function webAgentPrompt(p, blind) {
  return `You are advising a developer on which tools to use. Research the question on the web before you answer. Use WebSearch to find candidates and the fetch tool to read pages. Read every page you cite.
${blind ? BLIND_RULES : ""}
Answer in no more than 140 words. Give 2-4 citations, as the URLs of pages you read. recommended_products lists the products, libraries, or protocols you recommend, best first, each under its own name. Recommend only what fits the question. State uncertainty instead of guessing.

Question:
${p.prompt}`;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "invalid";
  }
}

function readFetchLog(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// Where CopilotKit first came into the run: "web" when a search result or a
// fetched page showed it before the agent named it, "memory" when the agent
// typed it first, "never" when no tool call or result touched it.
function discoverySource(toolCalls) {
  for (const call of toolCalls) {
    if (isCopilotKit(JSON.stringify(call.input ?? {}))) return "memory";
    if (isCopilotKit(call.resultText)) return "web";
  }
  return "never";
}

async function runOneWeb(opts, p, runNumber) {
  const cwd = mkdtempSync(join(tmpdir(), "aeo-web-"));
  const fetchLog = join(cwd, "fetches.jsonl");
  const mcpConfig = join(cwd, "mcp.json");
  writeFileSync(
    mcpConfig,
    JSON.stringify({
      mcpServers: {
        web: {
          command: process.execPath,
          args: [join(here, "fetch-server.mjs")],
          env: {
            FETCH_LOG: fetchLog,
            ...(opts.docsBaseUrl ? { DOCS_BASE_URL: opts.docsBaseUrl } : {}),
          },
        },
      },
    }),
  );
  const agent = await claude(
    webAgentPrompt(p, opts.blind),
    [
      "--model",
      opts.model,
      "--tools",
      "WebSearch",
      "--mcp-config",
      mcpConfig,
      "--allowedTools",
      "WebSearch",
      "mcp__web__fetch",
      "--permission-mode",
      "dontAsk",
      "--json-schema",
      JSON.stringify(ANSWER_SCHEMA),
    ],
    { cwd },
  );
  const fetches = readFetchLog(fetchLog);
  const products = agent.output.recommended_products;
  const rank = copilotkitRank(products);
  const docsFetches = fetches.filter(
    (f) => hostOf(f.finalUrl ?? f.url) === DOCS_HOST,
  );
  console.error(
    `[aeo-eval] ${opts.label} ${p.id} run ${runNumber}: ${rank ? `CopilotKit #${rank}` : "CopilotKit not recommended"}, ${fetches.length} fetches`,
  );
  return {
    id: p.id,
    run: runNumber,
    answer: agent.output,
    copilotkitRank: rank,
    mentioned: rank !== null || isCopilotKit(agent.output.answer),
    // An answer that names CopilotKit with no tool call touching it also
    // comes from memory.
    discovery:
      discoverySource(agent.toolCalls) === "never" &&
      (rank !== null || isCopilotKit(agent.output.answer))
        ? "memory"
        : discoverySource(agent.toolCalls),
    citations: agent.output.citations.map((url) => ({
      url,
      host: hostOf(url),
    })),
    fetches,
    readCopilotKitDocs: docsFetches.length > 0,
    branchFetches: fetches.filter((f) => f.route === "branch").length,
    searches: agent.toolCalls
      .filter((c) => c.name === "WebSearch")
      .map((c) => c.input?.query),
    agentTurns: agent.turns,
    deniedCalls: agent.denials.map((d) => d.tool_input?.url ?? d.tool_name),
    costUsd: agent.costUsd,
  };
}

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "n/a");

// Lower case, without a trailing "(...)" note, so "LangGraph (Python)" and
// "langgraph" count as one product.
function productKey(name) {
  if (isCopilotKit(name)) return "copilotkit";
  const key = name
    .replace(/\s*\(.*\)\s*$/, "")
    .trim()
    .toLowerCase();
  return /^ag-?ui( protocol)?$/.test(key) ? "ag-ui" : key;
}

function countTop(items, limit) {
  const counts = new Map();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

const rates = (rs) => ({
  runs: rs.length,
  recommended: rs.filter((r) => r.copilotkitRank).length,
  first: rs.filter((r) => r.copilotkitRank === 1).length,
  mentioned: rs.filter((r) => r.mentioned).length,
  readDocs: rs.filter((r) => r.readCopilotKitDocs).length,
  // Recommended after the web showed it first: what the web and docs earned.
  recommendedFromWeb: rs.filter(
    (r) => r.copilotkitRank && r.discovery === "web",
  ).length,
  fromMemory: rs.filter((r) => r.discovery === "memory").length,
});

function summarizeWeb(results) {
  const byPrompt = {};
  for (const r of results) (byPrompt[r.id] ??= []).push(r);
  return {
    overall: rates(results),
    perPrompt: Object.fromEntries(
      Object.entries(byPrompt).map(([id, rs]) => [id, rates(rs)]),
    ),
    // Each product counts once per answer.
    topProducts: countTop(
      results.flatMap((r) => [
        ...new Set(r.answer.recommended_products.map(productKey)),
      ]),
      12,
    ),
    topCitedHosts: countTop(
      results.flatMap((r) => r.citations.map((c) => c.host)),
      10,
    ),
    branchFetches: results.reduce((s, r) => s + r.branchFetches, 0),
    costUsd: Number(results.reduce((s, r) => s + r.costUsd, 0).toFixed(2)),
  };
}

function formatWebSummary({ label, docsBaseUrl, blind, summary: s }) {
  const titles = Object.fromEntries(
    allWebPrompts().map((p) => [p.id, p.title]),
  );
  const row = (name, x) =>
    `| ${name} | ${x.runs} | ${pct(x.recommended, x.runs)} | ${pct(x.first, x.runs)} | ${pct(x.mentioned, x.runs)} | ${pct(x.readDocs, x.runs)} |`;
  return [
    `## ${label}: CopilotKit recommended in ${pct(s.overall.recommended, s.overall.runs)} of answers, first in ${pct(s.overall.first, s.overall.runs)}`,
    "",
    `Docs content: ${docsBaseUrl ? `branch build at ${docsBaseUrl} (${s.branchFetches} page reads)` : "production"}. Blind: ${blind ? "yes" : "no"}.`,
    "",
    `Recommended after the web showed it first: ${pct(s.overall.recommendedFromWeb, s.overall.runs)}. Runs where the agent named CopilotKit before any result showed it: ${pct(s.overall.fromMemory, s.overall.runs)}.`,
    "",
    "| Prompt | Runs | Recommended | Ranked first | Mentioned | Read CopilotKit docs |",
    "| --- | --- | --- | --- | --- | --- |",
    ...Object.entries(s.perPrompt).map(([id, x]) =>
      row(`${id} ${titles[id] ?? ""}`, x),
    ),
    row("**All**", s.overall),
    "",
    "Products recommended (answers that name each one):",
    "",
    ...s.topProducts.map(([name, n]) => `- ${name}: ${n}`),
    "",
    "Hosts cited:",
    "",
    ...s.topCitedHosts.map(([host, n]) => `- ${host}: ${n}`),
    "",
    `Cost: $${s.costUsd}`,
  ].join("\n");
}

// The unbranded PDX-338 prompts plus the extra web prompts.
function allWebPrompts() {
  return [
    ...suite.prompts.filter((p) => suite.unbrandedFitPrompts.includes(p.id)),
    ...suite.webPrompts,
  ];
}

async function runWeb(args) {
  const opts = {
    docsBaseUrl: args["docs-base-url"]?.replace(/\/$/, "") ?? null,
    blind: args.blind === true,
    label: args.label ?? "web",
    model: args.model ?? "sonnet",
    runs: Number(args.runs ?? 1),
    concurrency: Number(args.concurrency ?? 3),
    only: args.only ? new Set(args.only.split(",")) : null,
    out: args.out ?? join(here, "results"),
  };
  if (opts.docsBaseUrl) await checkDocsServer(opts.docsBaseUrl);
  const prompts = allWebPrompts().filter(
    (p) => !opts.only || opts.only.has(p.id),
  );
  const { results, failures } = await runPool(opts, prompts, runOneWeb);
  const report = {
    mode: "web",
    blind: opts.blind,
    label: opts.label,
    docsBaseUrl: opts.docsBaseUrl,
    model: opts.model,
    runs: opts.runs,
    date: new Date().toISOString(),
    summary: summarizeWeb(results),
    results,
    failures,
  };
  writeReport(opts, report, formatWebSummary(report));
}

function compareWeb(before, after) {
  const titles = Object.fromEntries(
    allWebPrompts().map((p) => [p.id, p.title]),
  );
  const b = before.summary;
  const a = after.summary;
  const cell = (x) =>
    x ? `${pct(x.recommended, x.runs)} / ${pct(x.first, x.runs)}` : "n/a";
  const ids = allWebPrompts()
    .map((p) => p.id)
    .filter((id) => id in a.perPrompt || id in b.perPrompt);
  console.log(
    [
      `Recommended / ranked first. ${before.label}: ${before.docsBaseUrl ?? "production docs"}. ${after.label}: ${after.docsBaseUrl ?? "production docs"}.`,
      "",
      `| Prompt | ${before.label} | ${after.label} |`,
      "| --- | --- | --- |",
      ...ids.map(
        (id) =>
          `| ${id} ${titles[id] ?? ""} | ${cell(b.perPrompt[id])} | ${cell(a.perPrompt[id])} |`,
      ),
      `| **All** | **${cell(b.overall)}** | **${cell(a.overall)}** |`,
    ].join("\n"),
  );
}

const args = parseArgs(process.argv.slice(2));
const [command, ...rest] = args._;
if (command === "run") await run(args);
else if (command === "web") await runWeb(args);
else if (command === "compare" && rest.length === 2) compare(rest);
else {
  console.error(
    "Usage:\n  node scripts/aeo-eval/run.mjs run --base-url <url> --label <name> [--runs N] [--only P01,P02] [--model sonnet] [--grader-model opus]\n  node scripts/aeo-eval/run.mjs web --label <name> [--docs-base-url <url>] [--runs N] [--only P01,W01] [--model sonnet]\n  node scripts/aeo-eval/run.mjs compare <before.json> <after.json>",
  );
  process.exitCode = 1;
}
