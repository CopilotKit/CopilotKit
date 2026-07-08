/**
 * Microsoft Teams demo bot for `@copilotkit/channels-teams`.
 *
 * Every message runs a real CopilotKit `BuiltInAgent`. Replies stream by
 * message-edit, and the agent renders **Adaptive Cards automatically** by
 * calling the `show_card` tool whenever structured data (a summary, status,
 * table, list of facts) is clearer as a card than as prose. Consequential
 * actions go through a human-in-the-loop approval gate (`confirm_write`).
 *
 * Requires `OPENAI_API_KEY`. No Microsoft credentials are needed to test in the
 * M365 Agents Playground:
 *
 *   pnpm start        # bot on http://localhost:3978/api/messages
 *   pnpm playground   # M365 Agents Playground UI (http://localhost:56150)
 */
import "dotenv/config";
import { createServer } from "node:http";
import { createBot, defineBotTool } from "@copilotkit/channels";
import { teams, SanitizingHttpAgent } from "@copilotkit/channels-teams";
import { BuiltInAgent, CopilotSseRuntime } from "@copilotkit/runtime/v2";
import { createCopilotNodeListener } from "@copilotkit/runtime/v2/node";
import { z } from "zod";
import { hitlTools } from "./human-in-the-loop/index.js";
import { renderChartTool } from "./tools/render-chart.js";
import {
  Message,
  Header,
  Section,
  Fields,
  Field,
  Table,
  Row,
  Cell,
} from "@copilotkit/channels-ui";

// This demo drives a real agent, so an LLM key is required. Fail fast with a
// clear message rather than booting a bot that errors on the first message.
if (!process.env.OPENAI_API_KEY) {
  console.error(
    "Missing OPENAI_API_KEY.\n" +
      "This demo runs a CopilotKit BuiltInAgent, which needs an LLM API key.\n" +
      "  export OPENAI_API_KEY=sk-...   (or add it to examples/teams/.env)\n" +
      "Optional: OPENAI_MODEL (defaults to openai/gpt-5.5).",
  );
  process.exit(1);
}

const port = Number(process.env.PORT ?? 3978);

const SYSTEM_PROMPT =
  "You are a helpful Microsoft Teams assistant powered by CopilotKit. Keep " +
  "replies concise. When the user asks for a summary, status, list, " +
  "comparison, or any structured/tabular data, call the show_card tool to " +
  "render it as a rich Adaptive Card instead of writing it out as plain text.\n\n" +
  "Charts: when you have tabular/numeric data and the user wants it " +
  "visualized, parse it and call render_chart. Pass a chartType (one of " +
  "verticalBar, horizontalBar, line, pie, donut; pick what fits, defaults to " +
  "verticalBar), a short title, and a data array of {label, value} points with " +
  "the actual numbers inlined. Add xAxisTitle/yAxisTitle for bar and line " +
  "charts. render_chart posts a native chart in the conversation itself, so do " +
  "NOT restate the data as text or claim you can't make charts; you can. After " +
  "it posts, reply with at most one short line.\n\n" +
  "Where the data comes from: in a 1:1 chat, an uploaded file (CSV/JSON/text) " +
  "arrives as readable content and you can chart it directly. In a CHANNEL or " +
  "group chat, Microsoft Teams does NOT deliver uploaded files to bots — you " +
  "will only see the user's text, never the file's contents, even if Teams " +
  "shows a file card. So if the user references an attached file in a channel " +
  "but you received no file content, do NOT guess: briefly tell them Teams " +
  "doesn't share channel file uploads with bots, and ask them to paste the " +
  "data here (or send the file in a 1:1 chat with you). When they paste it, " +
  "chart it.\n\n" +
  "When the user asks to send, post, or announce something to the team, FIRST " +
  "draft the announcement, then call confirm_write with a one-line action " +
  "summary and the drafted text to get the user's approval. Only call " +
  "send_announcement after confirm_write returns approval; if it is declined, " +
  "acknowledge and do not send.";

// The agent is a CopilotKit `BuiltInAgent` served over a local
// `CopilotSseRuntime`, and the bot connects to it with a `SanitizingHttpAgent`
// (the re-runnable `HttpAgent` this package exports, as bot-slack does). A
// `BuiltInAgent` can't be handed to `createBot` directly: the bot's run loop
// re-invokes the agent once per tool round (call → result → respond), and a
// single `BuiltInAgent` instance rejects a second concurrent run. An
// `HttpAgent` is re-runnable, so it drives the multi-step + HITL loops cleanly.
const agentId = "assistant";
const runtimePort = Number(process.env.RUNTIME_PORT ?? 8200);
const runtimeAgentUrl = `http://localhost:${runtimePort}/api/copilotkit/agent/${agentId}/run`;

const runtime = new CopilotSseRuntime({
  agents: {
    [agentId]: new BuiltInAgent({
      model: process.env.OPENAI_MODEL ?? "openai/gpt-5.5",
      prompt: SYSTEM_PROMPT,
    }),
  },
});
// Bind to loopback only: this internal runtime is unauthenticated (it wraps the
// BuiltInAgent that holds the OpenAI key) and is consumed in-process via
// `runtimeAgentUrl` (localhost). Omitting the host would bind all interfaces and
// expose it on a deployed host.
createServer(
  createCopilotNodeListener({ runtime, basePath: "/api/copilotkit" }),
).listen(runtimePort, "127.0.0.1", () => {
  console.log(`Runtime (BuiltInAgent) listening on 127.0.0.1:${runtimePort}`);
});

/**
 * The card the **agent** renders on demand. The LLM calls this tool with
 * structured args; the handler turns them into an Adaptive Card via CopilotKit's
 * platform-agnostic JSX, then returns a short ack so the model doesn't restate
 * the card in prose.
 */
const showCard = defineBotTool({
  name: "show_card",
  description:
    "Render a rich Adaptive Card in Teams. Call this whenever a summary, " +
    "status report, comparison, set of facts, or tabular data would be clearer " +
    "as a card than as plain prose. Prefer a card for anything structured.",
  parameters: z.object({
    title: z.string().describe("Card header text"),
    body: z.string().describe("A short intro paragraph (markdown allowed)"),
    facts: z
      .array(z.object({ label: z.string(), value: z.string() }))
      .optional()
      .describe("Key/value facts rendered as a list"),
    table: z
      .object({
        columns: z.array(z.string()),
        rows: z.array(z.array(z.string())),
      })
      .optional()
      .describe("Optional simple table; each row is an array of cell strings"),
  }),
  async handler({ title, body, facts, table }, { thread }) {
    await thread.post(
      <Message accent="#5B5FC7">
        <Header>{title}</Header>
        <Section>{body}</Section>
        {facts && facts.length > 0 ? (
          <Fields>
            {facts.map((f, i) => (
              <Field key={i}>{`${f.label}: ${f.value}`}</Field>
            ))}
          </Fields>
        ) : null}
        {table ? (
          <Table columns={table.columns.map((header) => ({ header }))}>
            {table.rows.map((row, i) => (
              <Row key={i}>
                {row.map((cell, j) => (
                  <Cell key={j}>{cell}</Cell>
                ))}
              </Row>
            ))}
          </Table>
        ) : null}
      </Message>,
    );
    return "Displayed the card to the user. Give a one-line confirmation; do not restate the card's contents.";
  },
});

const bot = createBot({
  adapters: [teams({ port })],
  agent: (threadId: string) => {
    const agent = new SanitizingHttpAgent({ url: runtimeAgentUrl });
    agent.threadId = threadId;
    return agent;
  },
  tools: [showCard, renderChartTool, ...hitlTools],
});

// Run the agent on every message. It streams text by edit and renders Adaptive
// Cards on its own via the show_card tool. Uploaded files (e.g. a CSV) are
// recorded into the conversation transcript by the adapter — including their
// decoded contents — so `runAgent()` picks them up from the seeded history with
// no extra wiring, and they persist for follow-up turns.
bot.onMessage(async ({ thread, message }) => {
  // A bare file upload with no accompanying text should still do something
  // useful. The adapter only sets `contentParts` when it actually read file
  // content, so this nudges the agent to act on a dropped-in CSV instead of
  // running on an empty prompt and asking "what would you like me to do?".
  const hasFile = (message.contentParts?.length ?? 0) > 0;
  if (hasFile && message.text.trim().length === 0) {
    await thread.runAgent({
      prompt:
        "I uploaded a file with no other instructions. If it contains " +
        "tabular or numeric data, chart it with render_chart (pick a sensible " +
        "chart type); otherwise give me a short summary of what's in it.",
    });
    return;
  }
  await thread.runAgent();
});

await bot.start();

console.log(
  `Teams demo bot listening at http://localhost:${port}/api/messages`,
);
console.log(
  'Run `pnpm playground`, then ask for a "summary" or "status" to see an ' +
    "auto-rendered card, upload a CSV and ask for a chart to see render_chart, " +
    'or "announce X to the team" to see the HITL approval.',
);

// Stop the bot cleanly on exit.
const shutdown = async (signal: string): Promise<void> => {
  console.log(`\nReceived ${signal}, stopping…`);
  await bot.stop().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
