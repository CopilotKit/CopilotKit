/**
 * E2E harness entrypoint — Discord REST API-first.
 *
 * Posts real user messages to a test channel via the Discord REST API
 * (using DISCORD_TEST_USER_TOKEN if set, falling back to the bot token
 * for bot-to-bot testing), then polls the channel for the bot's reply
 * while it streams. Each sample records { elapsedMs, len, preview, balanced }
 * so we can observe the message evolve over time.
 *
 * ── CI guard ──────────────────────────────────────────────────────────────
 * This harness MUST NOT break normal CI.  It only runs when DISCORD_E2E=1 is
 * explicitly set.  The very first thing main() does is check that flag; if
 * absent it prints a one-liner and exits 0 (clean no-op).  The required test
 * guild and token env vars are:
 *
 *   DISCORD_E2E=1                  gate flag — set this to run
 *   DISCORD_TEST_GUILD_ID          ID of the throwaway test guild
 *   DISCORD_TEST_CHANNEL_ID        ID of the test channel inside that guild
 *   DISCORD_BOT_TOKEN              bot token (already in .env)
 *   DISCORD_TEST_USER_TOKEN        (optional) second-account token to send as a user
 *   DISCORD_BOT_USER_ID            bot's user ID (from Developer Portal → Bot)
 *   DISCORD_APP_ID                 application ID (from Developer Portal → General)
 *   DISCORD_INTERACTIONS_URL       (optional) bot's interactions endpoint URL, needed
 *                                  for button-click simulation
 *
 * Run:
 *   DISCORD_E2E=1 pnpm e2e
 *
 * No browser dependency — all communication goes through the Discord REST API.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CASES, BOT_MENTION } from "./cases.js";
import type { E2ECase } from "./cases.js";
import {
  postAsUser,
  channelHistory,
  messagesSince,
  watchForReply,
  watchForNextReply,
  isBalanced,
  USER_TOKEN,
  BOT_USER_ID,
  type DiscordMessage,
} from "./discord-api.js";

// ── CI gate ─────────────────────────────────────────────────────────────────
// Check BEFORE importing anything that throws on missing env vars.
if (!process.env["DISCORD_E2E"]) {
  console.log(
    "Discord e2e harness skipped (DISCORD_E2E not set). " +
      "Set DISCORD_E2E=1 plus the required env vars to run live against Discord. " +
      "See examples/discord/e2e/README.md for setup instructions.",
  );
  process.exit(0);
}

const RESULTS_DIR = "./e2e/results";
const TEST_CHANNEL =
  process.env["DISCORD_TEST_CHANNEL_ID"] ?? process.env["E2E_CHANNEL"] ?? "";

if (!TEST_CHANNEL) {
  console.error(
    "DISCORD_TEST_CHANNEL_ID (or E2E_CHANNEL) is required when DISCORD_E2E=1.",
  );
  process.exit(1);
}

if (!BOT_USER_ID) {
  console.error(
    "DISCORD_BOT_USER_ID is required when DISCORD_E2E=1. " +
      "Find it in the Discord Developer Portal → Your App → Bot.",
  );
  process.exit(1);
}

// ── Types ───────────────────────────────────────────────────────────────────

interface CaseResult {
  name: string;
  prompt: string;
  status: "pass" | "fail";
  errors: string[];
  durationMs: number;
  finalText: string | undefined;
  unbalancedSamples: number;
  samples: {
    elapsedMs: number;
    balanced: boolean;
    len: number;
    preview: string;
    /** Full text stored only for UNBALANCED samples to keep reports small. */
    full?: string;
  }[];
  followUp?: CaseResult;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Substitute the {{BOT_MENTION}} placeholder in a prompt with the real
 * Discord mention string for the bot, e.g. <@1234567890>.
 */
function resolveMention(prompt: string): string {
  if (!BOT_USER_ID) return prompt;
  return prompt.replaceAll(BOT_MENTION, `<@${BOT_USER_ID}>`);
}

function runExpectations(
  exp: NonNullable<E2ECase["expectations"]>,
  finalText: string | undefined,
  allBotMessages: DiscordMessage[],
  errors: string[],
  prefix = "",
): void {
  const tag = prefix ? `${prefix}: ` : "";

  if (exp.finalContains) {
    for (const needle of exp.finalContains) {
      if (!(finalText ?? "").toLowerCase().includes(needle.toLowerCase())) {
        errors.push(`${tag}missing: ${JSON.stringify(needle)}`);
      }
    }
  }
  if (exp.finalNotContains) {
    for (const needle of exp.finalNotContains) {
      if ((finalText ?? "").toLowerCase().includes(needle.toLowerCase())) {
        errors.push(`${tag}contained forbidden: ${JSON.stringify(needle)}`);
      }
    }
  }
  if (exp.balancedBrackets && finalText && !isBalanced(finalText)) {
    errors.push(`${tag}text has unbalanced brackets`);
  }
  if (exp.minLength && (finalText?.length ?? 0) < exp.minLength) {
    errors.push(
      `${tag}too short (${finalText?.length ?? 0} < ${exp.minLength})`,
    );
  }
  if (exp.perMessageChecks) {
    const msgShapes = allBotMessages.map((m) => ({
      content: m.content,
      components: m.components as Array<Record<string, unknown>> | undefined,
      author: m.author,
    }));
    const perErrs = exp.perMessageChecks(msgShapes);
    for (const e of perErrs) errors.push(`${tag}${e}`);
  }
}

// ── Case runner ──────────────────────────────────────────────────────────────

async function runCase(spec: E2ECase): Promise<CaseResult> {
  const errors: string[] = [];
  const samples: CaseResult["samples"] = [];
  const t0 = Date.now();

  // Record the most-recent message in the channel before we send, so we can
  // use its ID as the `afterMessageId` anchor for messagesSince().
  const preHistory = await channelHistory(TEST_CHANNEL, 1);
  const anchorId = preHistory[0]?.id ?? "0";

  // Post the prompt as the test user (or bot if no user token).
  const prompt = resolveMention(spec.prompt);
  const sent = await postAsUser(TEST_CHANNEL, prompt);
  const sentMsgId = sent.id;
  if (!sentMsgId) errors.push("postAsUser returned no id");

  const sampleIntervalMs = spec.sampleIntervalMs ?? 1000;
  const maxWaitMs = spec.maxWaitMs ?? 30_000;

  const onSample = (s: { elapsedMs: number; text: string | undefined }) => {
    const text = s.text ?? "";
    const balanced = isBalanced(text);
    samples.push({
      elapsedMs: s.elapsedMs,
      balanced,
      len: text.length,
      preview: text.slice(0, 100),
      ...(text.length > 0 && !balanced ? { full: text } : {}),
    });
  };

  const result = await watchForReply({
    channelId: TEST_CHANNEL,
    afterMessageId: anchorId,
    intervalMs: sampleIntervalMs,
    timeoutMs: maxWaitMs,
    onSample,
  });

  const finalText = result.finalText;

  // Collect all bot messages that arrived after the anchor for perMessageChecks.
  const allBotMessages: DiscordMessage[] = [];
  try {
    const msgs = await messagesSince(TEST_CHANNEL, anchorId, 20);
    for (const m of msgs) {
      if (m.author.id === BOT_USER_ID || m.author.bot === true) {
        allBotMessages.push(m);
      }
    }
  } catch {
    // non-fatal: we still have finalText for basic assertions
  }

  const exp = spec.expectations ?? {};
  runExpectations(exp, finalText, allBotMessages, errors);

  const unbalancedSamples = samples.filter((s) => s.len > 0 && !s.balanced).length;
  if (exp.balancedBrackets && unbalancedSamples > 0) {
    errors.push(`${unbalancedSamples} mid-stream samples were not balanced`);
  }

  // ── Follow-up turn ─────────────────────────────────────────────────────
  let followUpResult: CaseResult | undefined;
  if (spec.followUp && sentMsgId && finalText) {
    const followErrors: string[] = [];
    const followSamples: CaseResult["samples"] = [];
    const f0 = Date.now();

    // Count existing bot messages so watchForNextReply knows when a NEW one lands.
    const existingBotCount = allBotMessages.length;

    // Post follow-up as a reply to the trigger message (thread continuation).
    await postAsUser(TEST_CHANNEL, spec.followUp.prompt, {
      replyToMessageId: sentMsgId,
    }).catch((e: Error) =>
      followErrors.push(`followUp send failed: ${e.message}`),
    );

    const f = await watchForNextReply({
      channelId: TEST_CHANNEL,
      afterMessageId: anchorId,
      seenCount: existingBotCount,
      intervalMs: sampleIntervalMs,
      timeoutMs: maxWaitMs,
      onSample: (s) => {
        const text = s.text ?? "";
        followSamples.push({
          elapsedMs: s.elapsedMs,
          balanced: isBalanced(text),
          len: text.length,
          preview: text.slice(0, 100),
        });
      },
    });

    const followText = f.finalText;
    const fexp = spec.followUp.expectations ?? {};

    if (fexp.finalContains) {
      for (const needle of fexp.finalContains) {
        if (!(followText ?? "").toLowerCase().includes(needle.toLowerCase())) {
          followErrors.push(`followUp missing: ${JSON.stringify(needle)}`);
        }
      }
    }
    if (fexp.minLength && (followText?.length ?? 0) < fexp.minLength) {
      followErrors.push(`followUp too short`);
    }

    followUpResult = {
      name: `${spec.name} → followUp`,
      prompt: spec.followUp.prompt,
      status: followErrors.length === 0 ? "pass" : "fail",
      errors: followErrors,
      durationMs: Date.now() - f0,
      finalText: followText,
      unbalancedSamples: followSamples.filter((s) => s.len > 0 && !s.balanced)
        .length,
      samples: followSamples,
    };
  }

  return {
    name: spec.name,
    prompt: spec.prompt,
    status:
      errors.length === 0 && (followUpResult?.status ?? "pass") === "pass"
        ? "pass"
        : "fail",
    errors,
    durationMs: Date.now() - t0,
    finalText,
    unbalancedSamples,
    samples,
    followUp: followUpResult,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Secondary credential check (the CI gate already ran at module load; this
  // provides a better message when the gate is set but tokens are absent).
  if (!process.env["DISCORD_BOT_TOKEN"]) {
    console.error(
      "DISCORD_BOT_TOKEN missing in .env — the bot token is required for polling.",
    );
    process.exit(1);
  }
  if (!USER_TOKEN) {
    console.warn(
      "DISCORD_TEST_USER_TOKEN not set — messages will be sent with the bot token. " +
        "The bot's own-message guard may suppress replies. " +
        "A second-account token is recommended for accurate e2e coverage.",
    );
  }

  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = join(RESULTS_DIR, stamp);
  mkdirSync(runDir, { recursive: true });

  const results: CaseResult[] = [];

  // Optional substring filter — `CASE_FILTER='A1' pnpm e2e` to run one case.
  const filter = process.env["CASE_FILTER"];
  const selected = filter
    ? CASES.filter((c) => c.name.includes(filter))
    : CASES;

  for (const spec of selected) {
    process.stdout.write(`\n──── ${spec.name} ────\n`);
    try {
      const r = await runCase(spec);
      const flag = r.status === "pass" ? "✓" : "✗";
      console.log(
        `  ${flag} ${r.durationMs}ms  len=${r.finalText?.length ?? 0}  samples=${r.samples.length}  unbalanced=${r.unbalancedSamples}`,
      );
      if (r.errors.length) console.log("    " + r.errors.join("\n    "));
      if (r.followUp) {
        const fflag = r.followUp.status === "pass" ? "✓" : "✗";
        console.log(
          `    ↳ followUp ${fflag} ${r.followUp.durationMs}ms  len=${r.followUp.finalText?.length ?? 0}  samples=${r.followUp.samples.length}  unbalanced=${r.followUp.unbalancedSamples}`,
        );
        if (r.followUp.errors.length)
          console.log("      " + r.followUp.errors.join("\n      "));
      }
      results.push(r);
    } catch (err) {
      console.log(`  ✗ exception: ${(err as Error).message}`);
      results.push({
        name: spec.name,
        prompt: spec.prompt,
        status: "fail",
        errors: [(err as Error).message],
        durationMs: 0,
        finalText: undefined,
        unbalancedSamples: 0,
        samples: [],
      });
    }
  }

  writeFileSync(
    join(runDir, "report.json"),
    JSON.stringify({ ranAt: stamp, botUserId: BOT_USER_ID, results }, null, 2),
  );
  const pass = results.filter((r) => r.status === "pass").length;
  console.log(
    `\n${pass}/${results.length} cases passed. Report: ${runDir}/report.json`,
  );
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
