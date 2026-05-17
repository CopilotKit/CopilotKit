/**
 * End-to-end test: bridge-restart-recovery for LangGraph interrupts and
 * HITL components.
 *
 * Verifies that after a bridge restart between picker-post and click,
 * the picker is still actionable. Slack is the source of truth for
 * both the bound resume value (`button.value`) AND the dispatch
 * context (`message.metadata.event_payload.{handler, ...}`).
 *
 * Two scenarios:
 *
 *   • **interrupt** — LangGraph `interrupt()` from `schedule_meeting`.
 *     Resume mechanism: `runAgent({forwardedProps:{command:{resume}}})`
 *     thaws the paused checkpoint.
 *
 *   • **HITL** — `defineHumanInTheLoop` frontend tool (`confirm`).
 *     Resume mechanism: same `runAgent` forwarded-props resume, which
 *     the CopilotKit middleware turns into a tool-result message for
 *     the intercepted frontend-tool call.
 *
 * Flow per scenario:
 *
 *   1. Spawn bridge instance #1 (in-process). Start it.
 *   2. Post a user prompt that triggers the picker.
 *   3. Poll Slack until the picker lands; assert metadata + per-button
 *      encoded values are present.
 *   4. **Stop** instance #1 — its in-memory `HumanInTheLoopRegistry`
 *      is discarded.
 *   5. Spawn bridge instance #2.
 *   6. Inject a synthetic Slack `block_actions` event into instance
 *      #2's Bolt app via `app.processEvent`.
 *   7. Poll Slack: assert the picker has been replaced in-place by
 *      the resolved-state render AND the agent's natural-language
 *      reply lands in the same thread.
 *   8. Tear down instance #2.
 *
 * Run: `pnpm e2e:restart`
 */
import "dotenv/config";
import type { ReceiverEvent } from "@slack/bolt";
import {
  createSlackBridge,
  defaultSlackContext,
  defaultSlackTools,
  type SlackBridge,
} from "../src/index.js";
import { appComponents } from "../app/components/index.js";
import { appContext } from "../app/context/app-context.js";
import { appHitl } from "../app/human-in-the-loop/index.js";
import { appInterruptHandlers } from "../app/interrupts/index.js";
import { appTools } from "../app/tools/index.js";
import {
  postAsUser,
  threadReplies,
  BOT_USER_ID,
} from "./slack-api.js";

const TEST_CHANNEL = process.env.E2E_CHANNEL ?? "C0B49MEJ1HQ"; // #ag-ui-bot-test

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`missing required env var ${name}`);
    process.exit(1);
  }
  return v;
}

function makeBridge() {
  return createSlackBridge({
    agentUrl: required("AGENT_URL"),
    slackBotToken: required("SLACK_BOT_TOKEN"),
    slackAppToken: required("SLACK_APP_TOKEN"),
    tools: [...defaultSlackTools, ...appTools],
    context: [...defaultSlackContext, ...appContext],
    components: appComponents,
    humanInTheLoopComponents: appHitl,
    interruptHandlers: appInterruptHandlers,
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForPicker(
  parentTs: string,
  expectedEventType: string,
): Promise<{
  ts: string;
  buttons: Array<{ action_id: string; value: string; text: string }>;
  metadata: { event_type?: string; event_payload?: Record<string, unknown> };
}> {
  const t0 = Date.now();
  while (Date.now() - t0 < 30_000) {
    await wait(1500);
    const r = await threadReplies(TEST_CHANNEL, parentTs, true);
    const picker = r.find((m) => {
      const md = (m as { metadata?: { event_type?: string } }).metadata;
      return m.user === BOT_USER_ID && md?.event_type === expectedEventType;
    }) as { ts?: string; blocks?: Array<Record<string, unknown>>; metadata?: { event_type?: string; event_payload?: Record<string, unknown> } } | undefined;
    if (!picker) continue;
    const buttons: Array<{ action_id: string; value: string; text: string }> = [];
    for (const b of picker.blocks ?? []) {
      if (b.type === "actions" && Array.isArray((b as { elements?: unknown[] }).elements)) {
        for (const el of (b as { elements: Array<{ type?: string; action_id?: string; value?: string; text?: { text?: string } }> }).elements) {
          if (el.type === "button" && el.action_id && el.value) {
            buttons.push({
              action_id: el.action_id,
              value: el.value,
              text: el.text?.text ?? "",
            });
          }
        }
      }
    }
    return {
      ts: picker.ts!,
      buttons,
      metadata: picker.metadata ?? {},
    };
  }
  throw new Error(`never saw picker with event_type=${expectedEventType}`);
}

async function waitForAgentReply(parentTs: string, sinceCount: number, regex: RegExp, timeoutMs = 30_000): Promise<string> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await wait(1500);
    const r = await threadReplies(TEST_CHANNEL, parentTs);
    const replies = r.filter((m) => m.user === BOT_USER_ID);
    for (let i = sinceCount; i < replies.length; i++) {
      const txt = replies[i]?.text ?? "";
      if (regex.test(txt)) return txt;
    }
  }
  throw new Error(`never saw agent reply matching ${regex}`);
}

interface BlockActionsBody {
  type: "block_actions";
  user: { id: string; username: string; name: string; team_id: string };
  api_app_id: string;
  token: string;
  container: { type: "message"; message_ts: string; channel_id: string; thread_ts?: string };
  trigger_id: string;
  team: { id: string; domain: string };
  channel: { id: string; name: string };
  message: { ts: string; type: "message"; user: string; text: string; blocks: unknown[]; thread_ts?: string };
  state: { values: Record<string, unknown> };
  response_url: string;
  actions: Array<{
    action_id: string;
    block_id: string;
    text: { type: "plain_text"; text: string; emoji: boolean };
    type: "button";
    value: string;
    action_ts: string;
  }>;
}

function synthesiseBlockActions(args: {
  pickerTs: string;
  parentTs: string;
  actionId: string;
  value: string;
  buttonText: string;
}): BlockActionsBody {
  return {
    type: "block_actions",
    user: { id: "U05PN5700P9", username: "atai", name: "atai", team_id: "T05QFA4BW9X" },
    api_app_id: "A0B49763Y66",
    token: "synthetic-token",
    container: {
      type: "message",
      message_ts: args.pickerTs,
      channel_id: TEST_CHANNEL,
      thread_ts: args.parentTs,
    },
    trigger_id: "synthetic-trigger",
    team: { id: "T05QFA4BW9X", domain: "copilotkit" },
    channel: { id: TEST_CHANNEL, name: "ag-ui-bot-test" },
    message: {
      ts: args.pickerTs,
      type: "message",
      user: BOT_USER_ID,
      text: "",
      blocks: [],
      thread_ts: args.parentTs,
    },
    state: { values: {} },
    response_url: "",
    actions: [
      {
        action_id: args.actionId,
        block_id: "synthetic-block",
        text: { type: "plain_text", text: args.buttonText, emoji: true },
        type: "button",
        value: args.value,
        action_ts: `${Date.now() / 1000}`,
      },
    ],
  };
}

async function injectClick(bridge: SlackBridge, ev: BlockActionsBody): Promise<void> {
  let acked = false;
  const fakeEvent: ReceiverEvent = {
    body: ev,
    ack: async () => {
      acked = true;
    },
  };
  await bridge.app.processEvent(fakeEvent);
  if (!acked) throw new Error("Bolt didn't ack the synthetic event");
}

/**
 * One full restart-recovery cycle. Returns nothing; throws on any
 * assertion failure (the caller decides whether to continue running
 * the remaining scenarios).
 */
async function runScenario(args: {
  label: string;
  prompt: string;
  pickerEventType: string;
  pickButton: (
    buttons: Array<{ action_id: string; value: string; text: string }>,
  ) => { action_id: string; value: string; text: string };
  /**
   * Pattern the agent's natural-language reply must match. For
   * interrupts the graph is paused and resume produces a fresh
   * reply — set this to the expected text. For HITL the graph is
   * already finished; pass `undefined` to skip the reply check.
   */
  replyRegex?: RegExp;
  resolvedTextRegex: RegExp;
}): Promise<void> {
  console.log(`\n══════ ${args.label} ══════`);
  console.log(`[${args.label}] starting bridge instance #1…`);
  const b1 = makeBridge();
  await b1.start();
  console.log(`[${args.label}] instance #1 up`);

  const sent = await postAsUser(TEST_CHANNEL, args.prompt);
  const parentTs = (sent as { ts?: string }).ts!;
  console.log(`[${args.label}] posted prompt, parent ts:`, parentTs);

  const picker = await waitForPicker(parentTs, args.pickerEventType);
  console.log(`[${args.label}] picker landed at ts=%s with %d buttons`, picker.ts, picker.buttons.length);

  // Verify metadata.
  const evType = picker.metadata.event_type;
  if (evType !== args.pickerEventType) {
    throw new Error(`picker has event_type=${evType}, expected ${args.pickerEventType}`);
  }
  const ep = picker.metadata.event_payload as { handler?: string } | undefined;
  if (!ep?.handler) throw new Error("picker metadata missing handler");
  console.log(`[${args.label}] ✓ picker metadata: handler=%s`, ep.handler);

  for (const btn of picker.buttons) JSON.parse(btn.value); // throws if malformed
  console.log(`[${args.label}] ✓ all %d buttons carry JSON-encoded values`, picker.buttons.length);

  const existing = await threadReplies(TEST_CHANNEL, parentTs);
  const seenCount = existing.filter((m) => m.user === BOT_USER_ID).length;

  console.log(`[${args.label}] stopping bridge instance #1…`);
  await b1.stop();

  console.log(`[${args.label}] starting bridge instance #2 (fresh in-memory registry)…`);
  const b2 = makeBridge();
  await b2.start();

  const chosen = args.pickButton(picker.buttons);
  console.log(
    `[${args.label}] simulating click on action_id=%s text="%s" value=%s`,
    chosen.action_id,
    chosen.text,
    chosen.value.slice(0, 80),
  );
  try {
    await injectClick(
      b2,
      synthesiseBlockActions({
        pickerTs: picker.ts,
        parentTs,
        actionId: chosen.action_id,
        value: chosen.value,
        buttonText: chosen.text,
      }),
    );
    console.log(`[${args.label}] ✓ synthetic block_actions processed`);

    if (args.replyRegex) {
      const reply = await waitForAgentReply(parentTs, seenCount, args.replyRegex, 30_000);
      console.log(`[${args.label}] ✓ agent reply landed: %s`, reply);
    } else {
      // HITL: no agent reply on this turn — the LangGraph thread is
      // already finished; the resolved-render replacement IS the
      // visible outcome. Wait briefly to give chat.update time to land.
      await wait(2000);
      console.log(`[${args.label}] ✓ (no agent reply expected — HITL graph is already RUN_FINISHED)`);
    }

    // Verify picker replaced in-place.
    const after = await threadReplies(TEST_CHANNEL, parentTs);
    const replacedPicker = after.find((m) => m.ts === picker.ts) as
      | { blocks?: Array<Record<string, unknown>> }
      | undefined;
    if (!replacedPicker) throw new Error("original picker message vanished entirely");
    const stillHasButtons = (replacedPicker.blocks ?? []).some(
      (b) =>
        b.type === "actions" &&
        Array.isArray((b as { elements?: unknown[] }).elements) &&
        ((b as { elements: unknown[] }).elements as Array<{ type?: string }>).some(
          (e) => e.type === "button",
        ),
    );
    if (stillHasButtons) {
      throw new Error("picker still has buttons — resolved render didn't replace");
    }
    const sectionText = (
      (replacedPicker.blocks ?? []).find((b) => b.type === "section") as
        | { text?: { text?: string } }
        | undefined
    )?.text?.text;
    if (!sectionText || !args.resolvedTextRegex.test(sectionText)) {
      throw new Error(
        `resolved render didn't match ${args.resolvedTextRegex}; got: ${sectionText}`,
      );
    }
    console.log(
      `[${args.label}] ✓ picker replaced in-place by resolved render: %s`,
      sectionText.slice(0, 100),
    );
  } finally {
    await b2.stop();
  }
}

async function main() {
  await runScenario({
    label: "interrupt-restart",
    prompt: `<@${BOT_USER_ID}> please book a 1:1 with Alice next week to review Q2 goals.`,
    pickerEventType: "copilotkit_slack_interrupt",
    pickButton: (buttons) => {
      const b = buttons.find((btn) => {
        try {
          const v = JSON.parse(btn.value);
          return v && typeof v === "object" && "chosen_label" in v;
        } catch {
          return false;
        }
      });
      if (!b) throw new Error("no time-slot button found");
      return b;
    },
    replyRegex: /scheduled|booked/i,
    resolvedTextRegex: /booked/i,
  });

  await runScenario({
    label: "hitl-restart",
    prompt: `<@${BOT_USER_ID}> use the confirm component to ask me whether to proceed with deleting all my files. Use exactly the question 'Proceed with deleting all files?'`,
    pickerEventType: "copilotkit_slack_hitl",
    pickButton: (buttons) => {
      const b = buttons.find((btn) => {
        try {
          const v = JSON.parse(btn.value);
          return v && typeof v === "object" && v.confirmed === true;
        } catch {
          return false;
        }
      });
      if (!b) throw new Error("no Yes button found");
      return b;
    },
    // HITL's LangGraph thread is RUN_FINISHED — no agent reply on this
    // turn; just the resolved-render replacement of the picker.
    replyRegex: undefined,
    resolvedTextRegex: /confirmed|declined/i,
  });

  console.log("\n══════ ALL GREEN ══════");
  console.log("Both interrupt and HITL restart-recovery scenarios passed.");
}

main().catch((err) => {
  console.error("[restart-e2e] fatal:", err);
  process.exit(1);
});
