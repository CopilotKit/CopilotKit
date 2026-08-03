import "dotenv/config";
import { createConnection } from "node:net";
import { createChannel, HttpAgent } from "@copilotkit/channels";
import type { ChannelHandler, ChannelTool } from "@copilotkit/channels";
import { slack } from "@copilotkit/channels/slack";
import { LogLevel } from "@slack/bolt";
import { confirmWriteTool } from "./human-in-the-loop/confirm-write-tool.js";
import {
  ConfirmThing,
  confirmThingCard,
} from "./human-in-the-loop/confirm-thing.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[route-b] missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

// Defaults to the LangGraph probe agent in `agent-py/` (`uv run serve.py`).
// Point AGENT_URL at the TanStack runtime (`pnpm runtime`) instead to exercise
// the awaitChoice path — the two agents drive DIFFERENT HITL models, so which
// one this URL names decides which half of this file actually does the work.
const agentUrl =
  process.env["AGENT_URL"] ?? "http://127.0.0.1:8210/agent/thing/run";

// Channel-side tools DO reach the remote agent: createChannel serializes these
// into RunAgentInput.tools, HttpAgent POSTs them, runtime.ts forwards them to the
// model. confirm_write's handler calls thread.awaitChoice(), i.e. blocking HITL.
//
// NOTE: this only fires against the TanStack runtime (`pnpm runtime`), which
// forwards client tools to the model. Against the LangGraph agent
// (`agent-py/`, the default AGENT_URL below) the graph binds its OWN tools and
// ignores these, so the HITL you'll see there is the interrupt path wired up in
// `onInterrupt` further down — not this one.
const tools: ChannelTool[] = [confirmWriteTool];

const bot = createChannel({
  name: "route-b",
  identifyUser: "platform", // required; createChannel throws without it
  adapters: [
    slack({
      botToken: required("SLACK_BOT_TOKEN"),
      appToken: required("SLACK_APP_TOKEN"),
      showToolStatus: true,
      logLevel:
        process.env["SLACK_DEBUG"] === "1" ? LogLevel.DEBUG : LogLevel.INFO,
    }),
  ],
  tools,
  // Registering the picker is what makes a click DURABLE: without it, a click on
  // a card posted before a restart degrades to "action expired" instead of
  // re-firing the handler. That's the whole point of the interrupt path, so it
  // would be self-defeating to omit.
  components: [ConfirmThing],
  // AGENT_DEBUG=1 prints [LIFECYCLE] lines — the only positive proof that
  // process 2 actually dialed process 1.
  agent: () =>
    new HttpAgent({ url: agentUrl, debug: process.env["AGENT_DEBUG"] === "1" }),
});

// Register on BOTH. onMention alone silently drops every plain DM: a DM has no
// <@BOT> in its text, so `mentioned` is false and only messageHandlers run.
const handleTurn: ChannelHandler = async ({ thread }) => {
  try {
    await thread.runAgent();
  } catch (err) {
    // Transport failures throw here and are invisible in Slack. Agent-level
    // failures (bad OPENAI_API_KEY) do NOT throw — Slack shows ":warning: Agent
    // error: ...". Cover both.
    console.error("[route-b] agent run failed:", err);
    await thread
      .post("Sorry — I could not reach the agent. Check the host console.")
      .catch((postErr: unknown) =>
        console.error("[route-b] failed to post error notice:", postErr),
      );
  }
};

bot.onMention(handleTurn);
bot.onMessage(handleTurn);

/** The payload `create_thing` passes to `interrupt()` in agent-py/main.py. */
interface ThingInterrupt {
  kind?: string;
  action?: string;
  detail?: string | null;
}

// `ag_ui_langgraph` puts the interrupt payload on the wire as a JSON STRING
// (`value=dump_json_safe(interrupt.value)`), and every real adapter —
// slack/telegram/discord/whatsapp — JSON.parses it before calling this handler.
// `FakeAdapter`'s renderer does NOT, so a handler that assumes an object works
// in Slack and breaks in a headless harness. Normalize here so one handler
// serves both.
function asThingInterrupt(payload: unknown): ThingInterrupt | undefined {
  const value = typeof payload === "string" ? safeParse(payload) : payload;
  return typeof value === "object" && value !== null
    ? (value as ThingInterrupt)
    : undefined;
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

// LEGACY interrupt HITL. "on_interrupt" is NOT an arbitrary label: it's the
// AG-UI custom event name that LangGraph's adapter emits for `interrupt()`
// (`LangGraphEventTypes.OnInterrupt`), and the Slack adapter only captures
// custom events whose name is in its `interruptEventNames` set — which defaults
// to exactly `{"on_interrupt"}`. Rename this string and the interrupt silently
// vanishes: the graph stays suspended forever with nothing posted to Slack.
//
// The run loop ENDS after this handler returns; the graph is parked in the
// agent's checkpointer until a button click calls `thread.resume()`.
bot.onInterrupt("on_interrupt", async ({ payload: raw, thread }) => {
  const payload = asThingInterrupt(raw);
  if (payload?.kind !== "confirm_create_thing") {
    // Don't strand the graph on an interrupt shape we don't recognise — say so
    // loudly, because the alternative is a thread that just goes quiet. Log
    // `raw`, not the normalized value: when normalization is what failed,
    // `payload` is undefined and tells you nothing.
    console.error("[route-b] unrecognised interrupt payload:", raw);
    await thread.post(
      `The agent paused with an interrupt I don't know how to render: \`${JSON.stringify(raw)}\``,
    );
    return;
  }
  await thread.post(
    confirmThingCard({
      action: payload.action ?? "Create thing",
      detail: payload.detail ?? undefined,
    }),
  );
});

const shutdown = (signal: string): void => {
  console.log(`[route-b] ${signal} received, stopping…`);
  bot.ɵruntime
    .stop()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      console.error("[route-b] stop failed:", err);
      process.exit(1);
    });
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

/** Is anything listening on the URL's host:port? */
function portIsOpen(parsed: URL, timeoutMs = 2000): Promise<boolean> {
  const port = Number(parsed.port) || (parsed.protocol === "https:" ? 443 : 80);
  return new Promise((resolve) => {
    const socket = createConnection({ host: parsed.hostname, port });
    const settle = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
  });
}

type Preflight =
  | { ok: true }
  | {
      ok: false;
      reason: "malformed" | "whitespace" | "unreachable" | "no-route";
    };

/**
 * Validate the agent URL as far as possible WITHOUT starting a run.
 *
 * A port check alone is not enough, and that gap has already bitten once: pasting
 * a whole shell command into `AGENT_URL=` yields a URL whose host and port are
 * perfectly valid — `new URL()` percent-encodes the spaces rather than throwing —
 * so the socket connects and every message then 404s on
 * `/agent/thing/run%20pnpm%20--filter…`. Hence the explicit whitespace check and
 * the per-agent route probe.
 *
 * `ag_ui_langgraph` mounts `GET {agentPath}/health` beside the POST endpoint, so
 * that path answers "does this exact route exist" — 200 when it does, 404 when the
 * path is wrong. A missing `/health` is NOT treated as failure: other AG-UI
 * servers (e.g. the TanStack runtime on :8200) don't mount one, and refusing to
 * boot against them would be worse than the 404 this is meant to prevent.
 */
async function preflightAgent(url: string): Promise<Preflight> {
  if (/\s/.test(url)) return { ok: false, reason: "whitespace" };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!(await portIsOpen(parsed))) return { ok: false, reason: "unreachable" };

  // Route probe. Only a definitive 404 fails the boot; anything else (200, 405,
  // a server without /health, a transport hiccup) is inconclusive, and
  // inconclusive must not block.
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    });
    if (res.status === 404) return { ok: false, reason: "no-route" };
  } catch {
    // Ignore — the port is open, which is all we can prove here.
  }
  return { ok: true };
}

// Fail at BOOT, not on the first message. Without this the first symptom is a
// bare "TypeError: fetch failed / ECONNREFUSED" thrown deep inside the run loop
// when someone finally pings the bot — which says nothing about which of the two
// agents you meant to run, and looks like a channels bug rather than a missing
// process. AGENT_URL from .env silently beats the default above, so the wrong
// port here is the single easiest mistake to make.
const check = await preflightAgent(agentUrl);
if (!check.ok) {
  const diagnosis: Record<typeof check.reason, string> = {
    whitespace:
      "AGENT_URL contains whitespace — it looks like a shell COMMAND was pasted in, not just a URL.\n" +
      "            The spaces get percent-encoded into the path, so the port connects and every run 404s.",
    malformed: "AGENT_URL is not a parseable URL.",
    unreachable: "nothing is listening on that host:port.",
    "no-route":
      "the port is open but that PATH does not exist on the server (404). Right agent, wrong route.",
  };
  console.error(`[route-b] cannot use AGENT_URL=${JSON.stringify(agentUrl)}`);
  console.error(`[route-b] ${diagnosis[check.reason]}`);
  console.error("[route-b] valid values — pick the HITL path you want:");
  console.error(
    "[route-b]   AGENT_URL=http://127.0.0.1:8210/agent/thing/run                       (agent-py: uv run serve.py)",
  );
  console.error(
    "[route-b]   AGENT_URL=http://localhost:8200/api/copilotkit/agent/triage/run       (TanStack: pnpm runtime)",
  );
  console.error(
    "[route-b] NOTE: AGENT_URL in .env overrides the default in this file, so fix it THERE.",
  );
  process.exit(1);
}

await bot.ɵruntime.start();
console.log(`[route-b] started · slack socket-mode · agent ${agentUrl}`);
