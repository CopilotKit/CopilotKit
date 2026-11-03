// Requests every ported page at its live URL and lists the ones that fail.
//   BASE_URL=http://localhost:3004 node scripts/check-live-pages.mjs [filter]
// One URL per content file: docs at their own path, a framework's own pages
// under its first URL slug, reference pages under /reference/v2 (or their
// SDK folder).
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const base = process.env.BASE_URL ?? "http://localhost:3004";
const filter = process.argv[2] ?? "";
const live = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "content",
  "live",
);

// First URL slug per integrations folder (see LIVE_FRAMEWORKS in src/lib/live-scope.ts).
const FOLDER_SLUG = {
  ag2: "ag2",
  agno: "agno",
  "built-in-agent": "built-in-agent",
  "claude-sdk-python": "claude-sdk-python",
  "claude-sdk-typescript": "claude-sdk-typescript",
  "crewai-flows": "crewai-crews",
  adk: "google-adk",
  langgraph: "langgraph-python",
  llamaindex: "llamaindex",
  mastra: "mastra",
  "microsoft-agent-framework": "ms-agent-python",
  "pydantic-ai": "pydantic-ai",
  "aws-strands": "strands",
  a2a: "a2a",
  "agent-spec": "agent-spec",
  deepagents: "deepagents",
};
const REFERENCE_FOLDERS = new Set([
  "v1",
  "react-native",
  "vue",
  "angular",
  "core",
  "channels",
]);

const toSlugs = (file) =>
  file
    .replace(/\.mdx?$/, "")
    .split("/")
    .filter((s) => s !== "index" && !/^\(.+\)$/.test(s));

const urls = new Set();
for (const file of readdirSync(join(live, "docs"), { recursive: true })) {
  if (!/\.mdx?$/.test(file)) continue;
  const slugs = toSlugs(file);
  if (slugs[0] === "integrations") {
    const slug = FOLDER_SLUG[slugs[1]];
    if (slug) urls.add(`/${[slug, ...slugs.slice(2)].join("/")}`);
  } else if (slugs.length) {
    urls.add(`/${slugs.join("/")}`);
  }
}
for (const file of readdirSync(join(live, "reference"), { recursive: true })) {
  if (!/\.mdx?$/.test(file)) continue;
  const slugs = toSlugs(file);
  urls.add(
    `/reference/${REFERENCE_FOLDERS.has(slugs[0]) ? "" : "v2/"}${slugs.join("/")}`.replace(
      /\/$/,
      "",
    ),
  );
}

const queue = [...urls].filter((u) => u.includes(filter)).sort();
const failures = [];
let done = 0;
async function worker() {
  for (let url = queue.shift(); url; url = queue.shift()) {
    try {
      const res = await fetch(base + url, {
        redirect: "manual",
        signal: AbortSignal.timeout(300_000),
      });
      const body = res.status >= 400 ? await res.text() : "";
      if (res.status >= 400) {
        const why = body.match(/"message":"([^"]{0,240})/)?.[1] ?? "";
        failures.push(`${res.status} ${url} ${why.replace(/\\n/g, " ")}`);
      }
    } catch (err) {
      failures.push(`ERR ${url} ${err.message}`);
    }
    if (++done % 50 === 0)
      console.error(`[check-live-pages] ${done}/${urls.size}`);
  }
}
await Promise.all(Array.from({ length: 3 }, worker));
console.log(failures.sort().join("\n"));
console.log(`[check-live-pages] ${done - failures.length}/${done} ok`);
process.exitCode = failures.length ? 1 : 0;
