/**
 * E2E harness entrypoint for the Telegram bot.
 *
 * Control flow mirrors `examples/slack/e2e/run.ts`, adapted for the
 * Telegram Bot API polling model.
 *
 * ## Send mode
 *
 * The harness detects which send mode is available at startup:
 *
 *   AUTOMATED (approach a)
 *     Requires: TELEGRAM_SENDER_BOT_TOKEN set in .env.
 *     The sender bot posts each prompt into TELEGRAM_TEST_CHAT_ID; the
 *     main bot (TELEGRAM_BOT_TOKEN) sees it, processes it, and replies.
 *     The harness polls getUpdates on the MAIN bot token for the reply.
 *
 *   MANUAL-TRIGGER (approach b — fallback)
 *     No TELEGRAM_SENDER_BOT_TOKEN needed.
 *     The harness prints each prompt and waits for the operator to send it
 *     in the test chat. It then polls getUpdates on the main bot token for
 *     the bot's reply. Coverage is identical; only the trigger step is manual.
 *
 * Run with:  pnpm e2e:telegram
 *
 * Optional env:
 *   CASE_FILTER     substring filter on case name (e.g. CASE_FILTER='C1' pnpm e2e:telegram)
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CASES } from "./telegram-cases.js";
import type { E2ECase } from "./telegram-cases.js";
import {
  drainUpdates,
  sendMessageAsSenderBot,
  watchForReply,
  watchForNextReply,
  isBalanced,
  SENDER_BOT_TOKEN,
  TEST_CHAT_ID,
} from "./telegram-api.js";

const RESULTS_DIR = "./e2e/results";

// ── Startup checks ────────────────────────────────────────────────────────────

if (!TEST_CHAT_ID) {
  console.error(
    "TELEGRAM_TEST_CHAT_ID missing in .env — set it to the numeric chat ID " +
      "of the chat where the bot is a member.",
  );
  process.exit(1);
}

const AUTOMATED = !!SENDER_BOT_TOKEN;
if (AUTOMATED) {
  console.log(
    "[e2e] Mode: AUTOMATED — sender bot will post prompts automatically.",
  );
} else {
  console.log(
    "[e2e] Mode: MANUAL-TRIGGER — you will need to send each prompt manually.\n" +
      "      (Set TELEGRAM_SENDER_BOT_TOKEN in .env for full automation.)",
  );
}

// ── Result types ──────────────────────────────────────────────────────────────

interface CaseResult {
  name: string;
  prompt: string;
  status: "pass" | "fail";
  errors: string[];
  durationMs: number;
  finalText: string | undefined;
  samples: {
    elapsedMs: number;
    balanced: boolean;
    len: number;
    preview: string;
    full?: string;
  }[];
  followUp?: CaseResult;
}

// ── Expectations runner ───────────────────────────────────────────────────────

function runExpectations(
  exp: NonNullable<E2ECase["expectations"]>,
  finalText: string | undefined,
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
}

// ── Case runner ───────────────────────────────────────────────────────────────

/**
 * Wait for the operator to send a prompt (manual-trigger mode).
 * Prints the prompt text and waits `promptWaitMs` for the user to act.
 */
async function waitForOperator(
  prompt: string,
  promptWaitMs: number,
): Promise<void> {
  console.log(
    `\n  [MANUAL] Please send the following message in the test chat:\n` +
      `  ┌──────────────────────────────────────────────────────────┐\n` +
      `  │ ${prompt.slice(0, 56).padEnd(56)} │\n` +
      `  └──────────────────────────────────────────────────────────┘\n` +
      `  Waiting up to ${Math.round(promptWaitMs / 1000)}s for your send…`,
  );
  await new Promise((r) => setTimeout(r, promptWaitMs));
}

async function runCase(spec: E2ECase): Promise<CaseResult> {
  const errors: string[] = [];
  const samples: CaseResult["samples"] = [];
  const t0 = Date.now();

  const sampleIntervalMs = spec.sampleIntervalMs ?? 1000;
  const maxWaitMs = spec.maxWaitMs ?? 30_000;

  // Drain stale updates so we don't accidentally match a previous run's reply.
  const drainFence = await drainUpdates();

  if (AUTOMATED) {
    // Automated mode: sender bot sends the prompt.
    await sendMessageAsSenderBot(TEST_CHAT_ID, spec.prompt).catch((e: Error) =>
      errors.push(`send failed: ${e.message}`),
    );
  } else {
    // Manual-trigger mode: give the operator 15 s to send the prompt manually.
    // This wait is BEFORE we start polling — the bot won't have replied yet.
    await waitForOperator(spec.prompt, 15_000);
  }

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
    chatId: TEST_CHAT_ID,
    sinceUpdateId: drainFence,
    intervalMs: sampleIntervalMs,
    timeoutMs: maxWaitMs,
    onSample,
  });

  // Capture the highest update_id consumed so the follow-up baseline is
  // correct. getUpdates is destructive (advancing the offset confirms/deletes
  // prior updates server-side), so we must NOT reuse drainFence here.
  const firstReplyFence = result.reachedUpdateId;

  const finalText = result.finalText;
  const exp = spec.expectations ?? {};
  runExpectations(exp, finalText, errors);

  const unbalancedSamples = samples.filter(
    (s) => s.len > 0 && !s.balanced,
  ).length;
  if (exp.balancedBrackets && unbalancedSamples > 0) {
    errors.push(`${unbalancedSamples} mid-stream samples were not balanced`);
  }

  if (exp.perReplyChecks && finalText !== undefined) {
    for (const e of exp.perReplyChecks([finalText])) {
      errors.push(e);
    }
  }

  // ── Follow-up turn ──────────────────────────────────────────────────────────
  let followUpResult: CaseResult | undefined;
  if (spec.followUp && finalText) {
    const followErrors: string[] = [];
    const followSamples: CaseResult["samples"] = [];
    const f0 = Date.now();

    // Since getUpdates is destructive, the first reply's updates are already
    // confirmed (gone from the server queue). The follow-up watcher starts from
    // firstReplyFence and will see only NEW updates, so seenCount = 0.
    const seenCount = 0;

    if (AUTOMATED && result.finalMessage) {
      await sendMessageAsSenderBot(TEST_CHAT_ID, spec.followUp.prompt, {
        replyToMessageId: result.finalMessage.message_id,
      }).catch((e: Error) =>
        followErrors.push(`followUp send failed: ${e.message}`),
      );
    } else {
      await waitForOperator(spec.followUp.prompt, 15_000);
    }

    const fResult = await watchForNextReply({
      chatId: TEST_CHAT_ID,
      sinceUpdateId: firstReplyFence,
      seenCount,
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

    const followText = fResult.finalText;
    const fexp = spec.followUp.expectations ?? {};
    if (fexp.finalContains) {
      for (const needle of fexp.finalContains) {
        if (!(followText ?? "").toLowerCase().includes(needle.toLowerCase())) {
          followErrors.push(`followUp missing: ${JSON.stringify(needle)}`);
        }
      }
    }
    if (fexp.minLength && (followText?.length ?? 0) < fexp.minLength) {
      followErrors.push("followUp too short");
    }

    followUpResult = {
      name: `${spec.name} → followUp`,
      prompt: spec.followUp.prompt,
      status: followErrors.length === 0 ? "pass" : "fail",
      errors: followErrors,
      durationMs: Date.now() - f0,
      finalText: followText,
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
    samples,
    followUp: followUpResult,
  };
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = join(RESULTS_DIR, stamp);
  mkdirSync(runDir, { recursive: true });

  const results: CaseResult[] = [];
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
        `  ${flag} ${r.durationMs}ms  len=${r.finalText?.length ?? 0}  samples=${r.samples.length}`,
      );
      if (r.errors.length) console.log("    " + r.errors.join("\n    "));
      if (r.followUp) {
        const fflag = r.followUp.status === "pass" ? "✓" : "✗";
        console.log(
          `    ↳ followUp ${fflag} ${r.followUp.durationMs}ms  len=${r.followUp.finalText?.length ?? 0}  samples=${r.followUp.samples.length}`,
        );
        if (r.followUp.errors.length) {
          console.log("      " + r.followUp.errors.join("\n      "));
        }
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
        samples: [],
      });
    }
  }

  writeFileSync(
    join(runDir, "report.json"),
    JSON.stringify(
      { ranAt: stamp, mode: AUTOMATED ? "automated" : "manual", results },
      null,
      2,
    ),
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
