import { serve } from "@hono/node-server";
import {
  CopilotRuntime,
  CopilotKitIntelligence,
  createCopilotEndpoint,
} from "@copilotkit/runtime/v2";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";

const intelligence = new CopilotKitIntelligence({
  apiKey:
    process.env.INTELLIGENCE_API_KEY ?? "cpk_sPRVSEED_seed0privat0longtoken00",
  apiUrl: process.env.INTELLIGENCE_API_URL ?? "http://localhost:4203",
  wsUrl: process.env.INTELLIGENCE_GATEWAY_WS_URL ?? "ws://localhost:4403",
});

const agent = new LangGraphAgent({
  deploymentUrl:
    process.env.LANGGRAPH_DEPLOYMENT_URL ?? "http://localhost:8123",
  graphId: "default",
  langsmithApiKey: process.env.LANGSMITH_API_KEY ?? "",
  // Default LangGraph recursion_limit is 25; the deepagents planner runs
  // its TODO/scratchpad loop on top of every tool call, so an occasional
  // 1-2-step planner detour (e.g. "find Ethan Moore" exploring virtual-fs
  // tools before settling on selectLead) can otherwise eat the budget
  // before the real frontend tool fires. 60 leaves headroom for multi-
  // step turns like "draft email + queue" without masking real loops.
  // The system prompt now explicitly forbids virtual-fs tools for lead
  // lookups (see agent/src/prompts.py FILESYSTEM TOOLS section) so this
  // is a safety belt, not the primary fix.
  assistantConfig: {
    recursion_limit: Number(process.env.LANGGRAPH_RECURSION_LIMIT ?? 60),
  },
});

const app = createCopilotEndpoint({
  basePath: "/api/copilotkit",
  runtime: new CopilotRuntime({
    intelligence,
    identifyUser: () => ({ id: "default", name: "Hackathon User" }),
    licenseToken: process.env.COPILOTKIT_LICENSE_TOKEN,
    agents: { default: agent },
    openGenerativeUI: true,
    a2ui: { injectA2UITool: false },
    mcpApps: {
      servers: [
        {
          type: "http",
          url: process.env.MCP_SERVER_URL || "http://localhost:3001/mcp",
          serverId: "manufact_local",
        },
      ],
    },
  }),
});

// Phase 05: rewrite "Failed to initialize thread" 500s into a structured
// payload the UI can show as an actionable hint.
//
// Why a Hono middleware: `createCopilotEndpoint` builds the runtime route
// inside the framework, so we can't intercept the error at the runtime
// constructor level. We post-process the response on the way out, matching
// conservatively (only when the response status is 5xx AND the body
// mentions the FK violation we know about) so we don't mask new failure
// modes that happen to share the "Failed to initialize thread" prefix.
//
// The `threads_user_id_fkey` violation is the seeded-default-user gotcha:
// the BFF identifies the user as `default` / `1_default`, but Intelligence's
// stock migration only seeds three demo users. `npm run seed` (wired into
// `npm run dev:infra`) inserts the missing rows. If a user runs `dev:bff`
// without `dev:infra`, this is the failure they hit.
app.use("*", async (c, next) => {
  await next();
  const status = c.res.status;
  if (status < 500 || status > 599) return;
  // Clone so we can read the body without consuming the streamed response.
  const cloned = c.res.clone();
  const ctype = cloned.headers.get("content-type") || "";
  // We only inspect JSON / text bodies — streamed SSE responses don't go
  // through this path because successful agent turns return 200 with
  // text/event-stream, never 500.
  if (!ctype.includes("json") && !ctype.includes("text")) return;
  let body: string;
  try {
    body = await cloned.text();
  } catch {
    return;
  }
  const isThreadFkey =
    body.includes("threads_user_id_fkey") ||
    (body.includes("Failed to initialize thread") &&
      body.includes("user_id"));
  if (isThreadFkey) {
    const remapped = {
      error: "Postgres user seed missing",
      hint: "Run `npm run seed` to seed the default user, then retry.",
      command: "npm run seed",
    };
    c.res = new Response(JSON.stringify(remapped), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
    return;
  }

  // Thread-lock recovery: a previous run on this thread errored mid-stream
  // (e.g. a recursion-limit blow-up before we bumped the ceiling) and the
  // LangGraph SDK's per-thread lock didn't release. Subsequent runs reject
  // with `AgentThreadLockedError: Thread <id> is locked`. Surface that as
  // a recoverable hint so the user knows to start a new conversation —
  // versus the raw rxjs stack trace they get otherwise.
  const isThreadLocked =
    body.includes("AgentThreadLockedError") ||
    /Thread\s+[0-9a-f-]{36}\s+is locked/i.test(body);
  if (isThreadLocked) {
    const remapped = {
      error: "Thread is locked",
      hint:
        "A previous turn errored mid-stream and didn't release the run " +
        "lock. Start a new conversation (sidebar → +) to continue. The " +
        "underlying cause has been fixed, but this thread is stuck.",
      command: "new-thread",
    };
    c.res = new Response(JSON.stringify(remapped), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
    return;
  }
});

const port = Number(process.env.PORT) || 4000;

serve({ fetch: app.fetch, port }, () => {
  console.log(`BFF ready at http://localhost:${port}`);
});
