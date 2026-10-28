#!/usr/bin/env node
// Checks that legacy docs.copilotkit.ai URLs redirect on a running v2 server
// the way showcase/shell-docs redirects them today. Cases come from
// shell-docs' redirect tests (src/lib/__tests__/redirects.test.ts,
// next-config-redirects.test.ts, seo-redirects.test.ts, src/middleware.test.ts),
// plus one sample per family of the middleware table and v2's own routes,
// which must not be redirected.
//
//   BASE_URL=http://localhost:3004 npm run check-redirects
//
// Status codes: next.config `permanent: true` answers 308, `permanent: false`
// 307, and `statusCode: 301` 301; src/proxy.ts answers 301.
//
// A redirect case is a GET, exactly what an inbound link sends. A
// "no redirect" case is an OPTIONS: next.config redirects and the proxy answer
// every method alike, but Next skips rendering the page for OPTIONS, so the
// check doesn't wait on page compilation or depend on the page existing yet.

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3004";
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 30_000);
const CONCURRENCY = 8;

const MOVED = 301; // proxy, and next.config `statusCode: 301`
const TEMPORARY = 307; // next.config `permanent: false`
const PERMANENT = 308; // next.config `permanent: true`
const AG_UI = "https://docs.ag-ui.com";

const SUFFIXES = ["", ".md", ".mdx"];

/** @type {{ from: string; to: string | null; status?: number }[]} */
const cases = [];
const redirect = (from, to, status) => cases.push({ from, to, status });
const none = (from) => cases.push({ from, to: null });
const withSuffixes = (pairs, status) => {
  for (const suffix of SUFFIXES) {
    for (const [from, to] of pairs) {
      redirect(`${from}${suffix}`, `${to}${suffix}`, status);
    }
  }
};

// --- next.config: AG-UI Streams overview ---------------------------------
withSuffixes(
  [
    ["/threads", "/AG-UI-Streams"],
    ["/built-in-agent/threads", "/AG-UI-Streams"],
    ["/react/threads", "/AG-UI-Streams"],
    ["/react/built-in-agent/threads", "/AG-UI-Streams"],
    ["/mastra/threads", "/mastra/AG-UI-Streams"],
    ["/langgraph-python/threads", "/langgraph-python/AG-UI-Streams"],
    ["/react/mastra/threads", "/mastra/AG-UI-Streams"],
    ["/vue/threads", "/vue/AG-UI-Streams"],
    ["/vue/mastra/threads", "/vue/mastra/AG-UI-Streams"],
    ["/react-spa/mastra/threads", "/react-spa/mastra/AG-UI-Streams"],
    ["/react-native/mastra/threads", "/react-native/mastra/AG-UI-Streams"],
    ["/slack/mastra/threads", "/slack/mastra/AG-UI-Streams"],
    ["/teams/mastra/threads", "/teams/mastra/AG-UI-Streams"],
    ["/angular/threads", "/angular/guides/threads-memory-attachments-headless"],
    [
      "/angular/mastra/threads",
      "/angular/mastra/guides/threads-memory-attachments-headless",
    ],
    ["/learn/threads", "/intelligence/threads-explained"],
    ["/concepts/threads", "/intelligence/threads-explained"],
  ],
  PERMANENT,
);
none("/threads-import");
none("/threads-lifecycle");
none("/headless-threads");

// --- next.config: retired Open-JSON-UI -----------------------------------
withSuffixes(
  [
    ["/generative-ui/open-json-ui", "/generative-ui/a2ui"],
    [
      "/langgraph-python/generative-ui/open-json-ui",
      "/langgraph-python/generative-ui/a2ui",
    ],
    ["/built-in-agent/generative-ui/open-json-ui", "/generative-ui/a2ui"],
    [
      "/react/langgraph-python/generative-ui/open-json-ui",
      "/langgraph-python/generative-ui/a2ui",
    ],
    ["/react/generative-ui/open-json-ui", "/generative-ui/a2ui"],
    [
      "/angular/langgraph-python/generative-ui/open-json-ui",
      "/angular/langgraph-python/guides/a2ui",
    ],
    ["/angular/generative-ui/open-json-ui", "/angular/guides/a2ui"],
    [
      "/vue/langgraph-python/generative-ui/open-json-ui",
      "/vue/langgraph-python/generative-ui/a2ui",
    ],
    ["/vue/generative-ui/open-json-ui", "/vue/generative-ui/a2ui"],
    [
      "/react-spa/langgraph-python/generative-ui/open-json-ui",
      "/react-spa/langgraph-python/generative-ui/a2ui",
    ],
    [
      "/react-native/langgraph-python/generative-ui/open-json-ui",
      "/react-native/langgraph-python/generative-ui/a2ui",
    ],
    ["/generative-ui/specs/open-json-ui", "/generative-ui/a2ui"],
    ["/learn/generative-ui/specs/open-json-ui", "/generative-ui/a2ui"],
  ],
  PERMANENT,
);

// --- next.config: retired self-managed threads ---------------------------
withSuffixes(
  [
    ["/threads-self-managed", "/AG-UI-Streams"],
    ["/mastra/threads-self-managed", "/mastra/AG-UI-Streams"],
    [
      "/langgraph-python/threads-self-managed",
      "/langgraph-python/AG-UI-Streams",
    ],
    ["/built-in-agent/threads-self-managed", "/AG-UI-Streams"],
    ["/react/threads-self-managed", "/AG-UI-Streams"],
    ["/react/mastra/threads-self-managed", "/mastra/AG-UI-Streams"],
    [
      "/angular/threads-self-managed",
      "/angular/guides/threads-memory-attachments-headless",
    ],
    [
      "/angular/mastra/threads-self-managed",
      "/angular/mastra/guides/threads-memory-attachments-headless",
    ],
    ["/vue/threads-self-managed", "/vue/AG-UI-Streams"],
    ["/vue/mastra/threads-self-managed", "/vue/mastra/AG-UI-Streams"],
    [
      "/react-spa/mastra/threads-self-managed",
      "/react-spa/mastra/AG-UI-Streams",
    ],
    [
      "/react-native/mastra/threads-self-managed",
      "/react-native/mastra/AG-UI-Streams",
    ],
  ],
  PERMANENT,
);

// --- next.config: Channels guides ----------------------------------------
const CHANNEL_FRONTENDS = ["slack", "teams"];
const CHANNEL_GUIDE_SLUGS = [
  "overview",
  "intelligence",
  "tools",
  "identity-and-memory",
  "rich-messages",
  "posting-jsx-as-images",
  "render-and-carousel",
  "interactive",
  "commands-and-reactions",
  "files-and-multimodality",
  "threads-and-state",
  "persistence-and-scaling",
  "history-and-transcripts",
  "deploy-and-operate",
];
for (const slug of CHANNEL_GUIDE_SLUGS) {
  const guide = slug === "overview" ? "" : `/${slug}`;
  const pairs = [
    [`/channels/${slug}`, `/slack${guide}`],
    [`/mastra/channels/${slug}`, `/slack/mastra${guide}`],
    [`/built-in-agent/channels/${slug}`, `/slack${guide}`],
  ];
  for (const frontend of CHANNEL_FRONTENDS) {
    pairs.push(
      [`/${frontend}/mastra/channels/${slug}`, `/${frontend}/mastra${guide}`],
      [`/${frontend}/channels/${slug}`, `/${frontend}${guide}`],
      [`/${frontend}/built-in-agent/${slug}`, `/${frontend}${guide}`],
      [`/${frontend}/built-in-agent/channels/${slug}`, `/${frontend}${guide}`],
    );
  }
  withSuffixes(pairs, PERMANENT);
}
withSuffixes(
  [
    ["/channels", "/slack"],
    ["/slack/overview", "/slack"],
    ["/teams/mastra/overview", "/teams/mastra"],
    ["/slack/quickstart", "/slack/connect"],
    ["/teams/mastra/quickstart", "/teams/mastra/connect"],
    ["/channels/interactive/buttons/approve", "/slack/interactive"],
    [
      "/teams/mastra/channels/interactive/buttons/approve",
      "/teams/mastra/interactive",
    ],
  ],
  PERMANENT,
);
for (const suffix of SUFFIXES) {
  none(`/slack/tools${suffix}`);
  none(`/teams/mastra/threads-and-state${suffix}`);
}
none("/channels/not-a-guide");
none("/slack/mastra/channels/not-a-guide");
none("/teams/channels/not-a-guide");
none("/mastra/channels/not-a-guide");
none("/intelligence/channels");

for (const [legacy, canonical] of [
  ["quickstart", "connect"],
  ["ui-library", "rich-messages"],
  ["mcp", "tools"],
  ["configuration", "intelligence"],
  ["persistence", "persistence-and-scaling"],
  ["transcripts", "history-and-transcripts"],
]) {
  withSuffixes(
    [
      [`/channels/${legacy}`, `/slack/${canonical}`],
      [`/slack/mastra/channels/${legacy}`, `/slack/mastra/${canonical}`],
      [`/teams/channels/${legacy}`, `/teams/${canonical}`],
      [`/mastra/channels/${legacy}`, `/slack/mastra/${canonical}`],
      [`/slack/built-in-agent/channels/${legacy}`, `/slack/${canonical}`],
      [`/built-in-agent/channels/${legacy}`, `/slack/${canonical}`],
    ],
    PERMANENT,
  );
}

// --- next.config: Channels reference and Bots ----------------------------
for (const [legacy, reference] of [
  ["reference/channel", "classes/Channel"],
  ["reference/thread", "classes/Thread"],
  ["reference/callbacks", "types/JSXCallbacks"],
]) {
  withSuffixes(
    [
      [`/slack/${legacy}`, `/reference/channels/${reference}`],
      [`/teams/mastra/${legacy}`, `/reference/channels/${reference}`],
      [`/channels/${legacy}`, `/reference/channels/${reference}`],
    ],
    PERMANENT,
  );
}
for (const source of [
  "/reference/channels",
  "/reference/channels/classes/Channel",
  "/reference/channels/classes/Thread",
  "/reference/channels/components/Button",
  "/reference/channels/functions/createChannel",
  "/reference/channels/types/JSXCallbacks",
  "/reference/channels/types/StateStore",
]) {
  for (const suffix of SUFFIXES) none(`${source}${suffix}`);
}
withSuffixes(
  [
    ["/reference/channels/functions/createBot", "/reference/channels/functions/createChannel"],
    [
      "/reference/channels/functions/defineBotCommand",
      "/reference/channels/functions/defineChannelCommand",
    ],
    [
      "/reference/channels/functions/defineBotTool",
      "/reference/channels/functions/defineChannelTool",
    ],
    ["/reference/channels/types/BotNode", "/reference/channels/types/ChannelNode"],
    ["/reference/channels/slack", "/reference/channels/sdk/direct-adapters"],
    [
      "/reference/channels/slack/renderBlockKit",
      "/reference/channels/sdk/direct-adapters",
    ],
    ["/reference/channels/discord", "/reference/channels/sdk/direct-adapters"],
    [
      "/reference/channels/discord/DISCORD_LIMITS",
      "/reference/channels/sdk/direct-adapters",
    ],
    ["/bots", "/slack"],
    ["/bots/tools", "/slack/tools"],
    ["/bots/quickstart", "/slack/connect"],
    ["/reference/bot", "/reference/channels"],
    ["/reference/bot/classes/Thread", "/reference/channels"],
    ["/reference/bot/types/InteractionContext", "/reference/channels"],
    ["/reference/bot/components/ApproveButton", "/reference/channels"],
    ["/reference/bot/classes/Bot", "/reference/channels"],
  ],
  PERMANENT,
);
for (const [from, to] of [
  ["/channels/platforms/slack", "/slack"],
  ["/channels/platforms/teams", "/teams"],
  ["/channels/platforms/discord", "/slack"],
  ["/whatsapp", "/slack"],
  ["/whatsapp/quickstart", "/slack"],
  ["/slack/mastra/channels", "/slack/mastra"],
  ["/teams/channels", "/teams"],
  ["/slack/built-in-agent/channels", "/slack"],
  ["/built-in-agent/channels", "/slack"],
]) {
  redirect(from, to, PERMANENT);
}

// --- next.config: retired /ag-ui mirror ----------------------------------
redirect("/ag-ui", `${AG_UI}/introduction`, MOVED);
redirect("/ag-ui.md", `${AG_UI}/introduction.md`, MOVED);
redirect("/ag-ui/concepts/agents", `${AG_UI}/concepts/agents`, MOVED);
redirect("/ag-ui/concepts/agents.md", `${AG_UI}/concepts/agents.md`, MOVED);
redirect("/ag-ui/concepts/agents.mdx", `${AG_UI}/concepts/agents.md`, MOVED);
redirect("/ag-ui/drafts/interrupts", `${AG_UI}/concepts/interrupts`, MOVED);
redirect("/ag-ui/drafts/multimodal-messages", `${AG_UI}/concepts/messages`, MOVED);
redirect("/ag-ui/sdk/dart/client/overview", `${AG_UI}/sdk/dart/overview`, MOVED);
redirect("/ag-ui/sdk/rust/core/types.mdx", `${AG_UI}/sdk/rust/overview.md`, MOVED);

// --- next.config: renames and retired trees ------------------------------
for (const [from, to, status] of [
  ["/built-in-agent", "/", PERMANENT],
  ["/built-in-agent/ag-ui", "/backend/ag-ui", PERMANENT],
  ["/built-in-agent/tutorials/anything", "/quickstart", PERMANENT],
  ["/built-in-agent/premium", "/intelligence/overview", PERMANENT],
  ["/built-in-agent/premium/headless-ui", "/intelligence/headless-ui", PERMANENT],
  ["/built-in-agent/shared-state", "/shared-state", PERMANENT],
  ["/index", "/", PERMANENT],
  ["/frontend-actions", "/frontend-tools", PERMANENT],
  ["/troubleshooting/migrate-to-v2", "/migrate/v2", PERMANENT],
  ["/concepts/oss-vs-cloud", "/concepts/oss-vs-enterprise", PERMANENT],
  ["/custom-agent", "/backend/custom-agent", PERMANENT],
  ["/integrations/built-in-agent/custom-agent", "/backend/custom-agent", PERMANENT],
  ["/unselected", "/", PERMANENT],
  ["/unselected/quickstart", "/quickstart", PERMANENT],
  ["/unselected/frontend-actions", "/frontend-tools", PERMANENT],
  ["/unselected/tutorials/travel", "/tutorials/travel", PERMANENT],
  ["/unselected/generative-ui/tool-based", "/generative-ui/tool-based", PERMANENT],
  ["/learn", "/concepts/architecture", PERMANENT],
  ["/learn/whats-new/v1-50", "/whats-new/v1-50", PERMANENT],
  ["/concepts/three-types-of-gen-ui", "/concepts/generative-ui-overview", PERMANENT],
  ["/tutorials", "/", TEMPORARY],
  ["/tutorials/ai-travel-app", "/", TEMPORARY],
  ["/coding-agent-setup", "/coding-agents", TEMPORARY],
  ["/copilot-suggestions", "/reference/v2/hooks/useSuggestions", PERMANENT],
  [
    "/reference/v1/sdk/python/LangGraphAgent.md",
    "/reference/v1/sdk/python/LangGraphAGUIAgent.md",
    PERMANENT,
  ],
  ["/ag-ui-middleware", "/agentic-protocols/ag-ui-middleware", TEMPORARY],
  // Redirects pass the query string through.
  ["/threads?ref=blog", "/AG-UI-Streams?ref=blog", PERMANENT],
]) {
  redirect(from, to, status);
}
none("/mastra/generative-ui/your-components/display-only");
none("/mastra/generative-ui/your-components/interactive");

// --- proxy: route groups and retired raw-Markdown URLs --------------------
redirect("/(other)/learning.md", "/learning.md", MOVED);
redirect("/(root)/inspector", "/inspector", MOVED);
for (const suffix of SUFFIXES) {
  redirect(
    `/intelligence/connect-your-runtime${suffix}`,
    `/intelligence/quickstart${suffix}`,
    MOVED,
  );
}

// --- proxy: SEO table (one or more per family) ---------------------------
for (const [from, to] of [
  ["/coagents/tutorials/ai-travel-app/overview", "/langgraph-python/tutorials/ai-travel-app"],
  ["/coagents", "/langgraph-python"],
  ["/coagents/quickstart", "/langgraph-python/quickstart"],
  ["/coagents/quickstart.md", "/langgraph-python/quickstart.md"],
  ["/coagents/some/deep/page", "/langgraph-python/some/deep/page"],
  // Unlike next.config, the proxy table drops the query string (as shell-docs does).
  ["/coagents?ref=blog", "/langgraph-python"],
  ["/crewai-conversational-flows", "/crewai-flows/conversational-flows"],
  ["/crewai-conversational-flows/feature-parity", "/crewai-flows/conversational-flows"],
  ["/crewai-conversational-flows/quickstart", "/crewai-flows/quickstart"],
  ["/langgraph/quickstart/langgraph", "/langgraph-python/quickstart"],
  ["/coding-agents", "/build-with-agents"],
  ["/mastra/coding-agents", "/mastra/build-with-agents"],
  ["/api", "/reference/v2"],
  ["/api-reference", "/reference/v2"],
  ["/generative-ui", "/generative-ui/your-components/display-only"],
  ["/a2a-protocol", "/agentic-protocols/a2a"],
  ["/guides/self-hosting", "/backend/copilot-runtime"],
  ["/integrations/built-in-agent", "/"],
  ["/integrations/built-in-agent/server-tools", "/server-tools"],
  ["/integrations/deepagents/quickstart", "/deepagents/quickstart"],
  ["/integrations/adk", "/google-adk"],
  ["/integrations/langgraph/quickstart?copilot-hosting=self-hosted", "/langgraph-python/quickstart"],
  ["/mcp-apps", "/generative-ui/mcp-apps"],
  ["/deep-agents", "/deepagents"],
  ["/what-is-copilotkit", "/"],
  ["/frontends/react/quickstart", "/quickstart"],
  ["/frontends/vue", "/vue"],
  ["/microsoft-teams", "/teams"],
  ["/microsoft-teams/connect", "/teams/connect"],
  ["/langgraph/deep-agents", "/deepagents"],
  ["/migration-guides", "/migrate/v2"],
  ["/migration-guides/migrate-to-v2", "/migrate/v2"],
  ["/migration-guides/migrate-to-1.10.X", "/migrate/1.10.X"],
  ["/migration-guides/migrate-to-1.8.2", "/migrate/1.8.2"],
  ["/premium/observability", "/intelligence/overview"],
  ["/langgraph-python/premium/observability", "/langgraph-python/intelligence/overview"],
  ["/troubleshooting/observability-connectors", "/intelligence/overview"],
  ["/premium/inspector", "/inspector"],
  ["/langgraph-python/premium/inspector", "/langgraph-python/inspector"],
  ["/direct-to-llm/guides/premium/overview", "/intelligence/overview"],
  ["/direct-to-llm/guides/premium/headless-ui", "/intelligence/headless-ui"],
  ["/direct-to-llm/guides/premium/observability", "/intelligence/overview"],
  ["/direct-to-llm/guides/premium/inspector", "/inspector"],
  ["/premium", "/intelligence/overview"],
  ["/premium/headless-ui", "/intelligence/headless-ui"],
  ["/premium/headless-ui.md", "/intelligence/headless-ui.md"],
  ["/mastra/premium", "/mastra/intelligence/overview"],
  ["/langgraph/premium/self-hosting", "/langgraph-python/intelligence/self-hosting"],
  ["/troubleshooting", "/troubleshooting/common-issues"],
  ["/migrate", "/migrate/v2"],
  ["/concepts", "/concepts/architecture"],
  ["/langgraph/agentic-chat-ui", "/langgraph-python/prebuilt-components"],
  ["/mastra/generative-ui/backend-tools", "/mastra/generative-ui/tool-rendering"],
  ["/llamaindex/generative-ui/backend-tools", "/llamaindex/generative-ui/tool-rendering"],
  ["/agno/generative-ui/backend-tools", "/agno/generative-ui/tool-rendering"],
  ["/langgraph/concepts", "/langgraph-python"],
  ["/langgraph/concepts/state", "/langgraph-python"],
  ["/langgraph", "/langgraph-python"],
  ["/langgraph/quickstart", "/langgraph-python/quickstart"],
  ["/adk", "/google-adk"],
  ["/aws-strands/shared-state", "/strands/shared-state"],
  ["/microsoft-agent-framework/quickstart", "/ms-agent-dotnet/quickstart"],
  ["/mastra/tutorials/ai-travel-app", "/mastra/quickstart"],
  ["/direct-to-llm", "/"],
  ["/direct-to-llm/shared-state", "/shared-state"],
  ["/shared/frontend-tools", "/frontend-tools"],
  ["/generative-ui/langgraph/agentic", "/langgraph-python/agentic"],
  ["/generative-ui-specs/a2ui", "/generative-ui/specs/a2ui"],
  ["/guides/anything", "/"],
  ["/learn/frontend-tools", "/concepts/frontend-tools"],
]) {
  redirect(from, to, MOVED);
}
for (const path of [
  "/mastra/generative-ui/tool-based",
  "/llamaindex/generative-ui/tool-based",
  "/agno/generative-ui/tool-based",
  "/mastra/concepts/architecture",
  "/generative-ui/tool-rendering",
  "/vue",
  "/slack",
  "/react-native",
  "/custom-look-and-feel/slots",
  "/quickstart",
  "/runtime-server-adapter",
]) {
  none(path);
}

// --- v2's own routes: never redirected -----------------------------------
for (const path of [
  "/docs",
  "/docs/threads",
  "/docs/channels",
  "/docs/generative-ui/open-json-ui",
  "/docs/integrations/langgraph",
  "/docs/api",
  "/integrations",
  "/intelligence",
  "/examples",
  "/proto/threads",
  "/og/threads",
  "/api/threads",
  "/llms.txt",
  "/_next/static/chunks/(d)/page.js",
]) {
  none(path);
}

// ---------------------------------------------------------------------------

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function sameTarget(location, expected) {
  const actual = new URL(location, BASE_URL);
  if (/^https?:\/\//.test(expected)) return actual.href === expected;
  return `${actual.pathname}${actual.search}` === expected;
}

async function check({ from, to, status }) {
  let res;
  try {
    res = await fetch(new URL(from, BASE_URL), {
      method: to === null ? "OPTIONS" : "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return `${from}: request failed (${error.name}: ${error.message})`;
  }
  await res.body?.cancel();
  const location = res.headers.get("location");

  if (to === null) {
    return REDIRECT_STATUSES.has(res.status)
      ? `${from}: expected no redirect, got ${res.status} -> ${location}`
      : null;
  }
  if (res.status !== status || !location || !sameTarget(location, to)) {
    return `${from}: expected ${status} -> ${to}, got ${res.status}${location ? ` -> ${location}` : ""}`;
  }
  return null;
}

const failures = [];
for (let i = 0; i < cases.length; i += CONCURRENCY) {
  const results = await Promise.all(cases.slice(i, i + CONCURRENCY).map(check));
  failures.push(...results.filter(Boolean));
}

for (const failure of failures) console.error(`FAIL ${failure}`);
const redirects = cases.filter((c) => c.to !== null).length;
console.log(
  `${cases.length - failures.length}/${cases.length} passed against ${BASE_URL} ` +
    `(${redirects} redirects, ${cases.length - redirects} must-not-redirect)`,
);
process.exit(failures.length ? 1 : 0);
