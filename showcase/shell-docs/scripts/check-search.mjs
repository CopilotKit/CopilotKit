// Asks the search endpoint the questions readers ask most and checks the
// page they mean is near the top, so a ranking or index change can't quietly
// bury it again.
//   BASE_URL=http://localhost:3003 node scripts/check-search.mjs
// Each case: the query, the reader's scope (the URL prefix the search dialog
// sends), a URL prefix the top results must include, and how many of the
// first pages may come before it.

const base = process.env.BASE_URL ?? "http://localhost:3003";

const CASES = [
  { query: "mastra", expect: "/mastra", within: 3 },
  { query: "Mastra", scope: "/mastra", expect: "/mastra", within: 3 },
  { query: "langgraph", expect: "/langgraph-", within: 3 },
  { query: "crewai", expect: "/crewai-crews", within: 3 },
  { query: "google adk", expect: "/google-adk", within: 3 },
  { query: "human in the loop", expect: "/human-in-the-loop", within: 2 },
  { query: "shared state", expect: "/shared-state", within: 2 },
  { query: "generative ui", expect: "/generative-ui", within: 3 },
  { query: "frontend tools", expect: "/frontend-tools", within: 2 },
  { query: "quickstart", expect: "/quickstart", within: 3 },
  { query: "useAgent", expect: "/reference/v2/hooks/useAgent", within: 2 },
  {
    query: "useHumanInTheLoop",
    expect: "/reference/v2/hooks/useHumanInTheLoop",
    within: 2,
  },
  { query: "copilot runtime", expect: "/backend/copilot-runtime", within: 2 },
  { query: "angular", expect: "/angular", within: 3 },
  { query: "vue", expect: "/vue", within: 3 },
  { query: "slack", expect: "/slack", within: 3 },
  {
    query: "threads drawer",
    expect: "/prebuilt-components/copilot-threads-drawer",
    within: 2,
  },
  { query: "mcp", expect: "/agentic-protocols/mcp", within: 3 },
];

let failed = 0;
for (const { query, scope, expect, within } of CASES) {
  const params = new URLSearchParams({ query });
  if (scope) params.set("scope", scope);
  const res = await fetch(`${base}/api/search?${params}`);
  if (!res.ok) {
    console.log(`FAIL ${query}: HTTP ${res.status}`);
    failed++;
    continue;
  }
  const pages = (await res.json())
    .filter((r) => r.type === "page")
    .map((r) => r.url.split("#")[0]);
  const rank = pages.findIndex(
    (url) => url === expect || url.startsWith(expect),
  );
  const ok = rank !== -1 && rank < within;
  if (!ok) failed++;
  const where = scope ? ` (from ${scope})` : "";
  console.log(
    `${ok ? "ok  " : "FAIL"} ${query}${where}: ${expect} at ${rank === -1 ? "none" : rank + 1}; top: ${pages.slice(0, 4).join(", ")}`,
  );
}
console.log(`[check-search] ${CASES.length - failed}/${CASES.length} pass`);
process.exit(failed ? 1 : 0);
