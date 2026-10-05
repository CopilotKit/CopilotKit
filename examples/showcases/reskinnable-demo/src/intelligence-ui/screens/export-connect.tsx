"use client";

/**
 * The API and MCP destinations of Data export: nothing is written anywhere,
 * the screen hands over the current slice as code (curl, Python, TypeScript)
 * or as an MCP server any agent can connect to. Everything Intelligence
 * captured is reachable from your own tools.
 */
import { useState } from "react";
import { CopyButton } from "../ui/data-display/copy-button";
import type { ExportFilter, ExportFormat, ExportScope } from "../export/model";
import s from "./export-screen.module.css";

const HOST = "https://intelligence.copilotkit.ai";
const PROJECT = "ledgerline";
const KEY_ENV = "CPK_INTELLIGENCE_API_KEY";

/** The slice as plain key/value pairs, only the ones its scope uses. */
function slicePairs(
  scope: ExportScope,
  filters: readonly ExportFilter[],
  format: ExportFormat,
): [string, string][] {
  const pairs: [string, string][] = [
    ["space", scope.space],
    ["scope", scope.kind],
  ];
  if (scope.kind === "group" && scope.groupId)
    pairs.push(["group", scope.groupId]);
  if (scope.kind === "user" && scope.userId) pairs.push(["user", scope.userId]);
  const live = filters
    .filter((f) => f.value.trim())
    .map((f) => ({ field: f.field, op: f.op, value: f.value.trim() }));
  if (live.length) pairs.push(["q", JSON.stringify(live)]);
  pairs.push(["format", format]);
  return pairs;
}

type Filter = { field: string; op: string; value: string };
const filtersOf = (q: string) => JSON.parse(q) as Filter[];

/** The filters as a Python list literal. */
function pyList(q: string): string {
  const rows = filtersOf(q).map(
    (f) =>
      `{"field": ${JSON.stringify(f.field)}, "op": ${JSON.stringify(f.op)}, "value": ${JSON.stringify(f.value)}}`,
  );
  return `[${rows.join(", ")}]`;
}

/** The filters as a TypeScript array literal. */
function tsList(q: string): string {
  const rows = filtersOf(q).map(
    (f) =>
      `{ field: ${JSON.stringify(f.field)}, op: ${JSON.stringify(f.op)}, value: ${JSON.stringify(f.value)} }`,
  );
  return `[${rows.join(", ")}]`;
}

const ext = (format: ExportFormat) =>
  format === "csv" ? "csv" : format === "parquet" ? "parquet" : "jsonl";

function curl(pairs: [string, string][], format: ExportFormat): string {
  const lines = [
    `curl -G ${HOST}/api/v1/projects/${PROJECT}/trajectories/export \\`,
    `  -H "Authorization: Bearer $${KEY_ENV}" \\`,
    ...pairs.map(([k, v]) => `  --data-urlencode '${k}=${v}' \\`),
    `  -o trajectories.${ext(format)}`,
  ];
  return lines.join("\n");
}

function python(pairs: [string, string][], format: ExportFormat): string {
  const params = pairs
    .map(([k, v]) =>
      k === "q"
        ? `        "q": json.dumps(${pyList(v)}),`
        : `        "${k}": ${JSON.stringify(v)},`,
    )
    .join("\n");
  const read =
    format === "jsonl"
      ? `for line in res.iter_lines():\n    trajectory = json.loads(line)\n    print(trajectory["trajectory"]["title"], len(trajectory["threads"]))`
      : `with open("trajectories.${ext(format)}", "wb") as f:\n    for chunk in res.iter_content(1 << 16):\n        f.write(chunk)`;
  return `import json, os, requests

res = requests.get(
    "${HOST}/api/v1/projects/${PROJECT}/trajectories/export",
    headers={"Authorization": f"Bearer {os.environ['${KEY_ENV}']}"},
    params={
${params}
    },
    stream=True,
)
res.raise_for_status()

${read}`;
}

function typescript(pairs: [string, string][]): string {
  const params = pairs
    .map(([k, v]) =>
      k === "q"
        ? `  q: JSON.stringify(${tsList(v)}),`
        : `  ${k}: ${JSON.stringify(v)},`,
    )
    .join("\n");
  return `const params = new URLSearchParams({
${params}
});

const res = await fetch(
  \`${HOST}/api/v1/projects/${PROJECT}/trajectories/export?\${params}\`,
  { headers: { Authorization: \`Bearer \${process.env.${KEY_ENV}}\` } },
);

// One trajectory per line: every AG-UI event, product event and network request.
for (const line of (await res.text()).split("\\n").filter(Boolean)) {
  const { trajectory, threads } = JSON.parse(line);
  console.log(trajectory.title, threads.length);
}`;
}

const MCP_URL = `${HOST}/mcp/${PROJECT}`;

const MCP_CONFIG = JSON.stringify(
  {
    mcpServers: {
      "copilotkit-intelligence": {
        url: MCP_URL,
        headers: { Authorization: `Bearer \${${KEY_ENV}}` },
      },
    },
  },
  null,
  2,
);

const MCP_TOOLS: readonly { name: string; does: string }[] = [
  {
    name: "search_trajectories",
    does: "Find trajectories by user, outcome, surface, text or date",
  },
  {
    name: "get_trajectory",
    does: "One trajectory, every AG-UI and product event",
  },
  { name: "export_slice", does: "A whole slice as JSONL, Parquet or CSV" },
  {
    name: "list_learning_spaces",
    does: "Spaces, their users, groups and agents",
  },
  {
    name: "list_insights",
    does: "What Automatic Learning found, with evidence",
  },
  { name: "get_skill", does: "A published skill's SKILL.md and revisions" },
];

/** A filter row as a person would say it. */
function plain(f: ExportFilter): string {
  const v = f.value.trim();
  if (f.field === "outcome")
    return v === "agent_failed_user_completed"
      ? "the agent failed and a person finished"
      : v === "agent_succeeded"
        ? "the agent succeeded"
        : `the outcome is ${v}`;
  if (f.field === "surface")
    return v === "chatgpt" ? "it ran in ChatGPT" : `it ran on ${v}`;
  return `${f.field} ${f.op} ${v}`;
}

function describe(
  scope: ExportScope,
  filters: readonly ExportFilter[],
): string {
  const who =
    scope.kind === "user"
      ? `for ${scope.userId}`
      : scope.kind === "group"
        ? `for the ${scope.groupId} group`
        : "across every user and agent";
  const live = filters.filter((f) => f.value.trim());
  const where = live.length ? ` where ${live.map(plain).join(" and ")}` : "";
  return `In Ledgerline Expenses, pull the trajectories ${who}${where}, and tell me what the agent was missing each time.`;
}

type Lang = "curl" | "python" | "typescript";
const LANGS: readonly { id: Lang; name: string }[] = [
  { id: "curl", name: "curl" },
  { id: "python", name: "Python" },
  { id: "typescript", name: "TypeScript" },
];

export function ApiConnect(props: {
  readonly scope: ExportScope;
  readonly filters: readonly ExportFilter[];
  readonly format: ExportFormat;
}) {
  const [lang, setLang] = useState<Lang>("curl");
  const pairs = slicePairs(props.scope, props.filters, props.format);
  const code =
    lang === "curl"
      ? curl(pairs, props.format)
      : lang === "python"
        ? python(pairs, props.format)
        : typescript(pairs);
  return (
    <div className={s.connect}>
      <div className={s.langs} role="tablist" aria-label="Language">
        {LANGS.map((l) => (
          <button
            key={l.id}
            type="button"
            role="tab"
            aria-selected={lang === l.id}
            className={s.lang}
            onClick={() => setLang(l.id)}
          >
            {l.name}
          </button>
        ))}
      </div>
      <div className={s.code}>
        <div className={s.codeHead}>
          <span>{`GET /api/v1/projects/${PROJECT}/trajectories/export`}</span>
          <CopyButton label="Copy" value={code} />
        </div>
        <pre>{code}</pre>
      </div>
      <p className={s.connectNote}>
        Keys live in API Keys. Also on the API: trajectories, threads, insights,
        skills and eval candidates.
      </p>
    </div>
  );
}

export function McpConnect(props: {
  readonly scope: ExportScope;
  readonly filters: readonly ExportFilter[];
}) {
  const ask = describe(props.scope, props.filters);
  return (
    <div className={s.connect}>
      <p className={s.connectLead}>
        Claude, ChatGPT, Cursor or your own agent: add the server and ask.
      </p>
      <div className={s.mcpGrid}>
        <div className={s.connect}>
          <div className={s.code}>
            <div className={s.codeHead}>
              <span>Server URL</span>
              <CopyButton label="Copy" value={MCP_URL} />
            </div>
            <pre>{MCP_URL}</pre>
          </div>
          <div className={s.code}>
            <div className={s.codeHead}>
              <span>mcp.json</span>
              <CopyButton label="Copy" value={MCP_CONFIG} />
            </div>
            <pre>{MCP_CONFIG}</pre>
          </div>
        </div>
        <div className={s.connect}>
          <ul className={s.tools} aria-label="Tools">
            {MCP_TOOLS.map((t) => (
              <li key={t.name}>
                <code>{t.name}</code>
                <small>{t.does}</small>
              </li>
            ))}
          </ul>
          <div className={s.code}>
            <div className={s.codeHead}>
              <span>Try asking</span>
              <CopyButton label="Copy" value={ask} />
            </div>
            <pre className={s.ask}>{ask}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}
