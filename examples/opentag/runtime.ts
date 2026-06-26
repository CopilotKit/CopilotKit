/**
 * Agent backend for OpenTag.
 *
 * A single CopilotKit `BuiltInAgent` (an LLM, no MCP) served over AG-UI by a
 * `CopilotSseRuntime`. There is no Python, no LangGraph, no external service —
 * just an LLM and the tagging system prompt below.
 *
 * The bot-side primitives (read_thread, the confirm_tag HITL gate, the tag_card
 * component) are forwarded to the agent as client-provided tools by the bot on
 * every run — see `app/index.ts`. This file only owns the LLM call.
 *
 * Exposed route (the bot's `AGENT_URL`):
 *   POST http://localhost:8200/api/copilotkit/agent/opentag/run
 */
import "dotenv/config";
import { createServer } from "node:http";
import {
  BuiltInAgent,
  CopilotSseRuntime,
  convertInputToTanStackAI,
} from "@copilotkit/runtime/v2";
import { createCopilotNodeListener } from "@copilotkit/runtime/v2/node";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";

const SYSTEM_PROMPT = [
  "You are OpenTag, a thread-tagging assistant living in a Slack workspace.",
  "Your job: read a conversation and apply ONE concise label that captures",
  "what it is.",
  "",
  "Taxonomy — prefer these labels (pick the single best fit):",
  "- bug      — something is broken or not working as intended",
  "- question — someone is asking for help or information",
  "- feature  — a request or idea for new functionality",
  "- docs     — a documentation gap or request",
  "- urgent   — time-sensitive / blocking / an incident",
  "If none fit, choose a short lowercase label of your own (one or two words).",
  "",
  "How to tag — FOLLOW THIS ORDER:",
  "1. Call read_thread FIRST to read the actual conversation — never guess what",
  "   was said. (If the user handed you text directly via /tag, you may tag that.)",
  "2. Decide the single best label and a ONE-LINE rationale grounded in the thread.",
  "3. Call confirm_tag with that label + rationale. It posts an Apply/Cancel card",
  "   and BLOCKS until the user decides. Applying a tag is a WRITE — you may NEVER",
  "   skip this gate.",
  "4. ONLY if confirm_tag returns approved: call tag_card with the label,",
  "   rationale, and confidence to show the applied tag. If it returns declined,",
  "   acknowledge briefly and stop — do NOT call tag_card.",
  "",
  "Keep text replies to one short line at most. The cards are the answer — never",
  "restate a card's contents as prose.",
].join("\n");

// OpenAI by default. Override the model with AGENT_MODEL (a bare OpenAI id, or
// "openai/<id>" — the prefix is stripped); defaults to gpt-5.5. The cast is
// needed because AGENT_MODEL is dynamic and `openaiText` types its argument to
// the known OpenAI model literals.
const model = (process.env["AGENT_MODEL"] ?? "openai/gpt-5.5").replace(
  /^openai\//,
  "",
) as Parameters<typeof openaiText>[0];

// Factory mode: we own the LLM call (TanStack AI `chat()`); BuiltInAgent owns
// the AG-UI run lifecycle and converts TanStack's stream into AG-UI events.
// The bot's frontend tools (read_thread, confirm_tag, tag_card) arrive as
// `clientTools` and are passed straight through so the model can call them and
// the bot renders/gates them via the AG-UI client-tool round-trip.
const agent = new BuiltInAgent({
  type: "tanstack",
  factory: async (ctx) => {
    const {
      messages,
      systemPrompts,
      tools: clientTools,
    } = convertInputToTanStackAI(ctx.input);

    return chat({
      adapter: openaiText(model),
      messages,
      systemPrompts: [SYSTEM_PROMPT, ...systemPrompts],
      tools: clientTools as never[],
      // TanStack AI needs the full AbortController (not just the signal).
      abortController: ctx.abortController,
    });
  },
});

const runtime = new CopilotSseRuntime({
  agents: { opentag: agent },
});

const listener = createCopilotNodeListener({
  runtime,
  basePath: "/api/copilotkit",
  cors: true,
});

const port = Number(process.env["PORT"] ?? 8200);
createServer(listener).listen(port, () => {
  console.log(
    `[opentag-runtime] listening on http://localhost:${port}/api/copilotkit/agent/opentag/run`,
  );
});
