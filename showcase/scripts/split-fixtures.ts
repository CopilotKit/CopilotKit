// showcase/scripts/split-fixtures.ts
// One-time migration: split d5-all.json into d6/<integration>/<feature>.json files
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AIMOCK_DIR = path.resolve(__dirname, "..", "aimock");

interface FixtureMatch {
  [key: string]: unknown;
  context?: string;
}

interface Fixture {
  _comment?: string;
  match: FixtureMatch;
  response: unknown;
}

interface FixtureFile {
  _comment?: string;
  fixtures: Fixture[];
}

// Integration slugs (all 18 deployed)
const INTEGRATIONS = [
  "langgraph-python",
  "langgraph-typescript",
  "langgraph-fastapi",
  "google-adk",
  "mastra",
  "crewai-crews",
  "pydantic-ai",
  "claude-sdk-python",
  "claude-sdk-typescript",
  "agno",
  "ag2",
  "llamaindex",
  "strands",
  "langroid",
  "ms-agent-python",
  "ms-agent-dotnet",
  "spring-ai",
  "built-in-agent",
];

// Feature type to filename mapping
const FEATURE_FILES: Record<string, string> = {
  "agentic-chat": "agentic-chat.json",
  "hitl-in-chat": "hitl-in-chat.json",
  "hitl-in-app": "hitl-in-app.json",
  "tool-rendering": "tool-rendering.json",
  "tool-rendering-reasoning-chain": "tool-rendering-reasoning-chain.json",
  "gen-ui-agent": "gen-ui-agent.json",
  "gen-ui-tool-based": "gen-ui-tool-based.json",
  "shared-state-streaming": "shared-state-streaming.json",
  "gen-ui-headless-complete": "gen-ui-headless-complete.json",
  "headless-simple": "headless-simple.json",
  "headless-complete": "headless-complete.json",
  "shared-state-read": "shared-state-read.json",
  "shared-state-write": "shared-state-write.json",
  "shared-state-read-write": "shared-state-read-write.json",
  subagents: "subagents.json",
  "mcp-apps": "mcp-apps.json",
  "chat-slots": "chat-slots.json",
  "chat-css": "chat-css.json",
  "prebuilt-sidebar": "prebuilt-sidebar.json",
  "prebuilt-popup": "prebuilt-popup.json",
  auth: "auth.json",
  reasoning: "reasoning.json",
  "frontend-tools": "frontend-tools.json",
  "frontend-tools-async": "frontend-tools-async.json",
  "readonly-state": "readonly-state.json",
  "render-a2ui": "render-a2ui.json",
  voice: "voice.json",
  recorded: "recorded.json",
  "beautiful-chat": "beautiful-chat.json",
};

function inferFeatureType(fixture: Fixture): string {
  const comment = (fixture._comment ?? "").toLowerCase();

  // Ordered from most-specific to least-specific
  if (comment.includes("voice probe")) return "voice";
  if (comment.includes("tool-rendering-reasoning-chain"))
    return "tool-rendering-reasoning-chain";
  if (comment.includes("tool-rendering pill")) return "tool-rendering";
  if (comment.includes("headless-simple")) return "headless-simple";
  if (comment.includes("headless-complete")) return "headless-complete";
  if (comment.includes("hitl-in-app")) return "hitl-in-app";
  if (comment.includes("hitl-in-chat")) return "hitl-in-chat";
  if (comment.includes("shared-state-read-write"))
    return "shared-state-read-write";
  if (comment.includes("shared-state-read")) return "shared-state-read";
  if (comment.includes("subagent") || comment.includes("nested:"))
    return "subagents";
  if (comment.includes("mcp-apps")) return "mcp-apps";
  if (comment.includes("frontend-tools-async")) return "frontend-tools-async";
  if (comment.includes("frontend-tools")) return "frontend-tools";
  if (comment.includes("render_a2ui")) return "render-a2ui";
  if (
    comment.includes("reasoning-default") ||
    comment.includes("reasoning-display")
  )
    return "reasoning";
  if (comment.includes("readonly-state") || comment.includes("readonly_state"))
    return "readonly-state";
  if (comment.includes("recorded fixture from d5-recorded")) return "recorded";
  if (comment.includes("beautiful-chat") || comment.includes("beautiful chat"))
    return "beautiful-chat";
  if (comment.includes("agentic chat") || comment.includes("agentic-chat"))
    return "agentic-chat";
  if (comment.includes("pilot cell suggestion")) return "agentic-chat";
  if (comment.includes("agent-config")) return "agentic-chat";

  // For no-comment fixtures, try to infer from match keys
  const match = fixture.match;
  const userMsg = String(match.userMessage ?? "").toLowerCase();
  const toolCallId = String(match.toolCallId ?? "").toLowerCase();

  // Tool-rendering (weather, flights, stocks, dice, chain)
  if (userMsg.includes("weather in tokyo") || userMsg.includes("get_weather"))
    return "tool-rendering";
  if (userMsg.includes("weather in san francisco")) return "tool-rendering";
  if (userMsg.includes("flights from sfo")) return "tool-rendering";
  if (userMsg.includes("aapl") || userMsg.includes("stock price"))
    return "tool-rendering";
  if (userMsg.includes("roll a 20-sided die") || userMsg.includes("roll_d20"))
    return "tool-rendering";
  if (userMsg.includes("chain a few tools")) return "tool-rendering";
  if (toolCallId.includes("call_tr_d20")) return "tool-rendering";
  if (toolCallId.includes("call_tr_chain")) return "tool-rendering";
  if (userMsg.includes("sfo to jfk")) return "tool-rendering";
  if (toolCallId.includes("call_d5_display_flight")) return "tool-rendering";

  // Open Generative UI fixtures (generateSandboxedUi calls)
  if (
    userMsg.includes("3d axis") ||
    userMsg.includes("neural network") ||
    userMsg.includes("quicksort") ||
    userMsg.includes("fourier") ||
    userMsg.includes("calculator (calls") ||
    userMsg.includes("ping the host") ||
    userMsg.includes("inline expression")
  )
    return "gen-ui-tool-based";
  if (toolCallId.includes("call_d5_open_gen_ui")) return "gen-ui-tool-based";

  // Headless fixtures
  if (userMsg.includes("highlight:") || userMsg.includes("highlight note"))
    return "headless-complete";
  if (userMsg.includes("revenue chart") || userMsg.includes("revenue over"))
    return "headless-complete";
  if (userMsg.includes("ship the demo on friday")) return "headless-complete";
  if (toolCallId.includes("call_d5_highlight")) return "headless-complete";
  if (
    userMsg.includes("trigger the headless interrupt") ||
    userMsg.includes("resolve the interrupt")
  )
    return "headless-complete";

  // Frontend tools
  if (
    userMsg.includes("sunset") ||
    userMsg.includes("forest") ||
    userMsg.includes("cosmic")
  )
    return "frontend-tools";
  if (userMsg.includes("change_background")) return "frontend-tools";

  // Frontend tools async
  if (
    userMsg.includes("auth check") ||
    userMsg.includes("fetch the async metric")
  )
    return "frontend-tools-async";

  // HITL in-app
  if (userMsg.includes("refund") || userMsg.includes("request_user_approval"))
    return "hitl-in-app";
  if (userMsg.includes("downgrade")) return "hitl-in-app";
  if (userMsg.includes("escalate")) return "hitl-in-app";

  // HITL in-chat (booking, scheduling with people)
  if (userMsg.includes("1:1 with alice")) return "hitl-in-chat";
  if (userMsg.includes("intro call with the sales team")) return "hitl-in-chat";
  if (userMsg.includes("book a 30-minute onboarding call"))
    return "hitl-in-chat";
  if (toolCallId.includes("call_d5_schedule")) return "hitl-in-chat";

  // Shared state
  if (userMsg.includes("italian pasta") || userMsg.includes("recipe"))
    return "shared-state-read";
  if (
    userMsg.includes("favorite color") ||
    userMsg.includes("remember that my")
  )
    return "shared-state-read-write";
  if (userMsg.includes("recall the user preference"))
    return "shared-state-read-write";
  if (userMsg.includes("stream the counter")) return "shared-state-streaming";

  // Beautiful chat
  if (
    userMsg.includes("d5 beautiful-chat") ||
    userMsg.includes("beautiful-chat")
  )
    return "beautiful-chat";

  // Agentic chat (multi-turn conversations, goldfish, haiku, etc.)
  if (userMsg.includes("goldfish") || userMsg.includes("tank"))
    return "agentic-chat";
  if (userMsg.includes("haiku about nature")) return "agentic-chat";
  if (
    userMsg.includes("hi from the popup") ||
    userMsg.includes("hi from the sidebar")
  )
    return "agentic-chat";
  if (userMsg.includes("analyze data and call the tool")) return "agentic-chat";

  // Subagents
  if (userMsg.includes("cold exposure") || userMsg.includes("blog post"))
    return "subagents";
  if (userMsg.includes("reusable rockets")) return "subagents";
  if (userMsg.includes("tool calling")) return "subagents";
  if (userMsg.includes("remote work and draft")) return "subagents";

  // MCP
  if (userMsg.includes("excalidraw") || userMsg.includes("flowchart"))
    return "mcp-apps";
  if (userMsg.includes("create_view")) return "mcp-apps";

  // Render a2ui (gen-ui agent)
  if (userMsg.includes("pie chart") || userMsg.includes("kpi dashboard"))
    return "render-a2ui";
  if (userMsg.includes("bar chart") || userMsg.includes("status report"))
    return "render-a2ui";
  if (
    userMsg.includes("render the a2ui") ||
    userMsg.includes("render the declarative card")
  )
    return "render-a2ui";
  if (userMsg.includes("have the agent emit a ui")) return "render-a2ui";
  if (userMsg.includes("profile card for ada")) return "render-a2ui";
  if (userMsg.includes("trip to mars")) return "render-a2ui";

  // Gen-UI (interrupt, choice)
  if (userMsg.includes("gen-ui interrupt") || userMsg.includes("gen-ui choice"))
    return "gen-ui-tool-based";
  if (
    userMsg.includes("render an open gen-ui") ||
    userMsg.includes("continue the advanced gen-ui")
  )
    return "gen-ui-tool-based";

  // Readonly state / agent context
  if (userMsg.includes("who am i") || userMsg.includes("suggest next steps"))
    return "readonly-state";
  if (userMsg.includes("what do you know about me")) return "readonly-state";

  // CSS/theme fixtures
  if (
    userMsg.includes("css theme") ||
    userMsg.includes("switch theme") ||
    userMsg.includes("verify the css")
  )
    return "chat-css";
  if (
    userMsg.includes("tone:") ||
    userMsg.includes("expertise:") ||
    userMsg.includes("responselength:")
  )
    return "chat-css";

  // Chat slots
  if (userMsg.includes("chat slots")) return "chat-slots";

  // Auth
  if (userMsg.includes("auth check")) return "auth";

  // Prebuilt popup/sidebar
  if (userMsg.includes("popup") && !userMsg.includes("beautiful"))
    return "prebuilt-popup";
  if (userMsg.includes("sidebar") && !userMsg.includes("beautiful"))
    return "prebuilt-sidebar";

  // gen-ui-agent — set_steps pill fixtures (product launch, offsite, competitor)
  if (
    userMsg.includes("plan a product launch") ||
    userMsg.includes("team offsite") ||
    userMsg.includes("research our top competitor")
  )
    return "gen-ui-agent";
  if (toolCallId.includes("call_d5_set_steps")) return "gen-ui-agent";

  // Step-based project planning fixtures (frontend-tools-async query_notes)
  if (userMsg.includes("project planning")) return "frontend-tools-async";

  // Document writing tool-rendering
  if (
    userMsg.includes("poem about autumn") ||
    userMsg.includes("polite email declining") ||
    userMsg.includes("quantum computing for a curious teenager")
  )
    return "tool-rendering";
  if (toolCallId.includes("call_d5_write_document")) return "tool-rendering";

  // Image/document analysis
  if (
    userMsg.includes(
      "can you tell me what is in this demo image I just attached",
    ) ||
    userMsg.includes("can you tell me what is in this demo pdf I just attached")
  )
    return "multimodal";

  return "unknown";
}

// Load d5-all.json
const d5All: FixtureFile = JSON.parse(
  readFileSync(path.join(AIMOCK_DIR, "d5-all.json"), "utf-8"),
);

// De-duplicate (remove exact match duplicates)
const seen = new Set<string>();
const deduped: Fixture[] = [];
for (const f of d5All.fixtures) {
  const key = JSON.stringify(f.match);
  if (!seen.has(key)) {
    seen.add(key);
    deduped.push(f);
  }
}
console.log(`De-duplicated: ${d5All.fixtures.length} -> ${deduped.length}`);

// Group by inferred feature type
const byFeature = new Map<string, Fixture[]>();
for (const f of deduped) {
  const ft = inferFeatureType(f);
  const list = byFeature.get(ft) ?? [];
  list.push(f);
  byFeature.set(ft, list);
}

// Report categorization
console.log("\nCategorization results:");
for (const [featureType, fixtures] of byFeature) {
  console.log(`  ${featureType}: ${fixtures.length} fixtures`);
}

const unknownFixtures = byFeature.get("unknown") ?? [];
if (unknownFixtures.length > 0) {
  console.warn(
    `\nWARNING: ${unknownFixtures.length} fixtures could not be categorized:`,
  );
  for (const f of unknownFixtures) {
    const matchStr = JSON.stringify(f.match).slice(0, 120);
    console.warn(
      `  comment="${(f._comment ?? "").slice(0, 60)}" match=${matchStr}`,
    );
  }
}

// Step 6b: Tighten single-criterion fixtures
function tightenFixture(fixture: Fixture): Fixture {
  const matchKeys = Object.keys(fixture.match).filter(
    (k) => k !== "_comment" && k !== "context",
  );
  if (matchKeys.length === 1 && fixture.match.userMessage) {
    // Add turnIndex: 0 for first-turn fixtures with only userMessage
    return {
      ...fixture,
      match: { ...fixture.match, turnIndex: 0 },
    };
  }
  return fixture;
}

// Write per-feature files for LGP first (the gold standard)
const lgpSlug = "langgraph-python";
const lgpDir = path.join(AIMOCK_DIR, "d6", lgpSlug);
mkdirSync(lgpDir, { recursive: true });

for (const [featureType, fixtures] of byFeature) {
  if (featureType === "unknown") continue;
  const filename = FEATURE_FILES[featureType] ?? `${featureType}.json`;
  // Add context field to each fixture and tighten single-criterion ones
  const contextFixtures = fixtures.map((f) => {
    const tightened = tightenFixture(f);
    return {
      ...(tightened._comment ? { _comment: tightened._comment } : {}),
      match: { ...tightened.match, context: lgpSlug },
      response: tightened.response,
    };
  });
  const outPath = path.join(lgpDir, filename);
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        _meta: {
          description: `D6 fixtures for ${lgpSlug} / ${featureType}`,
          sourceFile: "d5-all.json",
          created: new Date().toISOString().split("T")[0],
        },
        fixtures: contextFixtures,
      },
      null,
      2,
    ),
  );
  console.log(`Wrote ${outPath}: ${contextFixtures.length} fixtures`);
}

// Copy LGP fixtures to other integrations with context field changed
for (const slug of INTEGRATIONS) {
  if (slug === lgpSlug) continue;
  const slugDir = path.join(AIMOCK_DIR, "d6", slug);
  mkdirSync(slugDir, { recursive: true });

  for (const [featureType, fixtures] of byFeature) {
    if (featureType === "unknown") continue;
    const filename = FEATURE_FILES[featureType] ?? `${featureType}.json`;
    const contextFixtures = fixtures.map((f) => {
      const tightened = tightenFixture(f);
      return {
        ...(tightened._comment ? { _comment: tightened._comment } : {}),
        match: { ...tightened.match, context: slug },
        response: tightened.response,
      };
    });
    const outPath = path.join(slugDir, filename);
    writeFileSync(
      outPath,
      JSON.stringify(
        {
          _meta: {
            description: `D6 fixtures for ${slug} / ${featureType}`,
            sourceFile: "d5-all.json",
            copiedFrom: lgpSlug,
            created: new Date().toISOString().split("T")[0],
          },
          fixtures: contextFixtures,
        },
        null,
        2,
      ),
    );
  }
  console.log(`Wrote d6/${slug}/: copied from ${lgpSlug}`);
}

// Handle unknown fixtures: write to a catch-all for manual review
if (unknownFixtures.length > 0) {
  for (const slug of INTEGRATIONS) {
    const slugDir = path.join(AIMOCK_DIR, "d6", slug);
    mkdirSync(slugDir, { recursive: true });
    const contextFixtures = unknownFixtures.map((f) => {
      const tightened = tightenFixture(f);
      return {
        ...(tightened._comment ? { _comment: tightened._comment } : {}),
        match: { ...tightened.match, context: slug },
        response: tightened.response,
      };
    });
    writeFileSync(
      path.join(slugDir, "_uncategorized.json"),
      JSON.stringify(
        {
          _meta: {
            description: `Uncategorized D5 fixtures for ${slug} (needs manual redistribution)`,
            created: new Date().toISOString().split("T")[0],
          },
          fixtures: contextFixtures,
        },
        null,
        2,
      ),
    );
  }
  console.log(
    `Wrote _uncategorized.json for ${unknownFixtures.length} fixtures across all integrations`,
  );
}
