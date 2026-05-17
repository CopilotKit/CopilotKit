/**
 * E2E harness entrypoint — API-first.
 *
 * Sends real user messages to `#ag-ui-bot-test` via `chat.postMessage` with
 * Atai's user token (xoxp-, in `.env` as SLACK_USER_TOKEN), then samples
 * the bot's reply via the Slack API while it streams. Each sample records
 * `{ elapsedMs, len, preview, balanced }` so we can see the message
 * evolve over time — bracket balance is asserted at every sample so the
 * auto-close streaming polish is verified mid-flight, not just at the end.
 *
 * No browser dependency. Run with:  pnpm e2e
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CASES, type E2ECase } from "./cases.js";
import {
  postAsUser,
  watchForReply,
  watchForNextReply,
  watchForChannelReply,
  channelHistory,
  threadReplies,
  isBalanced,
  USER_TOKEN,
  BOT_USER_ID,
} from "./slack-api.js";

const RESULTS_DIR = "./e2e/results";
const TEST_CHANNEL = process.env.E2E_CHANNEL ?? "C0B49MEJ1HQ"; // #ag-ui-bot-test

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
    /** Full text (only stored for UNBALANCED samples to keep the report small). */
    full?: string;
  }[];
  followUp?: CaseResult;
  /** Set when the case has an `interrupt` spec — details on the second reply. */
  interrupt?: {
    firstReplyText: string | undefined;
    secondReplyText: string | undefined;
    errors: string[];
  };
}

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
    errors.push(`${tag}too short (${finalText?.length ?? 0} < ${exp.minLength})`);
  }
}

async function runCase(spec: E2ECase): Promise<CaseResult> {
  const errors: string[] = [];
  const samples: CaseResult["samples"] = [];
  const t0 = Date.now();

  // Mark "now" in the channel timeline so we know which bot replies are ours.
  const beforeHist = await channelHistory(TEST_CHANNEL, 1);
  const sinceTs = beforeHist[0]?.ts ?? "0";

  // Send the prompt as Atai.
  const sent = await postAsUser(TEST_CHANNEL, spec.prompt);
  const parentTs = (sent as { ts?: string }).ts ?? "";
  if (!parentTs) errors.push("postAsUser returned no ts");

  // The bot's reply for an @mention goes into a thread off parentTs; for
  // a /agent slash command it lands flat in the channel. We can't tell
  // from the prompt alone — try the thread first, then fall back to flat.
  const flatMode = /^\/agent\b/.test(spec.prompt);
  const sampleIntervalMs = spec.sampleIntervalMs ?? 1000;
  const maxWaitMs = spec.maxWaitMs ?? 30_000;
  let followUpResult: CaseResult | undefined;

  // Schedule a mid-stream interrupt if the case asks for one.
  let interruptTimer: NodeJS.Timeout | undefined;
  if (spec.interrupt && parentTs) {
    interruptTimer = setTimeout(() => {
      postAsUser(TEST_CHANNEL, spec.interrupt!.prompt, { threadTs: parentTs }).catch(
        (e: Error) => errors.push(`interrupt send failed: ${e.message}`),
      );
    }, spec.interrupt.afterMs);
  }

  const onSample = (s: { elapsedMs: number; text: string | undefined }) => {
    const text = s.text ?? "";
    const balanced = isBalanced(text);
    samples.push({
      elapsedMs: s.elapsedMs,
      balanced,
      len: text.length,
      preview: text.slice(0, 100),
      // Capture full text for unbalanced samples so we can diagnose without
      // having to re-run. Skipped for balanced samples to keep reports small.
      ...(text.length > 0 && !balanced ? { full: text } : {}),
    });
  };

  if (interruptTimer === undefined) {
    /* no-op */
  }
  const result = flatMode
    ? await watchForChannelReply({
        channel: TEST_CHANNEL,
        sinceTs,
        intervalMs: sampleIntervalMs,
        timeoutMs: maxWaitMs,
        onSample,
      })
    : await watchForReply({
        channel: TEST_CHANNEL,
        parentTs,
        intervalMs: sampleIntervalMs,
        timeoutMs: maxWaitMs,
        onSample,
      });

  const finalText = result.finalText;
  const exp = spec.expectations ?? {};
  // Skip top-level expectations on the FIRST reply if this is an interrupt
  // case — the first reply is intentionally short/interrupted; the
  // assertions live under `spec.interrupt.firstExpectations`.
  if (!spec.interrupt) runExpectations(exp, finalText, errors);
  // Cross-stream assertion: every sample with text must be balanced.
  const unbalancedSamples = samples.filter((s) => s.len > 0 && !s.balanced).length;
  if (exp.balancedBrackets && unbalancedSamples > 0) {
    errors.push(`${unbalancedSamples} mid-stream samples were not balanced`);
  }
  // Table alignment check: when wrapping a GFM table in a fence, all
  // table rows inside the fence should have identical line length.
  if (exp.monospaceAlignedTable && finalText) {
    const tableRows = finalText
      .split("\n")
      .filter((l) => l.trim().startsWith("|") && l.trim().endsWith("|"));
    if (tableRows.length < 2) {
      errors.push("monospaceAlignedTable: didn't find ≥2 table rows");
    } else {
      const lengths = new Set(tableRows.map((l) => l.length));
      if (lengths.size !== 1) {
        errors.push(
          `monospaceAlignedTable: rows not aligned (lengths: ${[...lengths].join(", ")})`,
        );
      }
    }
  }
  // Per-reply checks: fetch ALL bot replies in the thread, not just the first.
  if (exp.perReplyChecks && parentTs) {
    try {
      const all = await threadReplies(TEST_CHANNEL, parentTs);
      const botRaw = all.filter((m) => m.user === BOT_USER_ID);
      const botMsgs = botRaw.map((m) => m.text ?? "");
      for (const e of exp.perReplyChecks(botMsgs, botRaw as unknown as Array<Record<string, unknown>>))
        errors.push(e);
    } catch (err) {
      errors.push(`perReplyChecks fetch failed: ${(err as Error).message}`);
    }
  }

  // Interrupt scenario: a second message is sent mid-stream and should
  // abort the first reply (marker `_(interrupted)_` in the partial), then
  // produce a fresh second reply in the same thread.
  let interruptResult: CaseResult["interrupt"];
  if (spec.interrupt && parentTs) {
    const iErrors: string[] = [];
    // Wait for the second bot reply to land.
    await new Promise((r) => setTimeout(r, 10000));
    const replies = await threadReplies(TEST_CHANNEL, parentTs);
    const botReplies = replies.filter((m) => m.user === BOT_USER_ID);
    // The bot may post intermediate status messages (`:warning:`, etc.)
    // that aren't the actual reply we want to assert against. Filter
    // those out and use first vs last as "the interrupted reply" and
    // "the new reply".
    const isStatus = (t: string) =>
      t.startsWith(":warning:") || t.startsWith(":wrench:") || t.startsWith(":white_check_mark:");
    const meaningful = botReplies.filter((m) => !isStatus(m.text ?? ""));
    const firstReply = meaningful[0]?.text;
    const secondReply = meaningful[meaningful.length - 1]?.text;
    const sameMessage = meaningful.length === 1;
    if (!firstReply) iErrors.push("no first bot reply found");
    if (sameMessage) iErrors.push("only one meaningful bot reply — interrupt didn't produce a new turn");
    if (spec.interrupt.firstExpectations) {
      runExpectations(spec.interrupt.firstExpectations, firstReply, iErrors, "first");
    }
    if (spec.interrupt.expectations) {
      runExpectations(spec.interrupt.expectations, secondReply, iErrors, "second");
    }
    interruptResult = { firstReplyText: firstReply, secondReplyText: secondReply, errors: iErrors };
    errors.push(...iErrors);
  }

  // If there's a follow-up, send it as a thread reply (no @mention) into
  // the same thread the first prompt created.
  if (spec.followUp && parentTs && finalText) {
    const followErrors: string[] = [];
    const followSamples: CaseResult["samples"] = [];
    const f0 = Date.now();
    // Count existing bot replies BEFORE sending the follow-up so we can
    // watch specifically for a NEW one.
    const existing = await threadReplies(TEST_CHANNEL, parentTs);
    const seenCount = existing.filter((m) => m.user === BOT_USER_ID).length;
    await postAsUser(TEST_CHANNEL, spec.followUp.prompt, { threadTs: parentTs }).catch(
      (e: Error) => followErrors.push(`followUp send failed: ${e.message}`),
    );
    const f = await watchForNextReply({
      channel: TEST_CHANNEL,
      parentTs,
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
    const fexp = spec.followUp.expectations ?? {};
    const followText = f.finalText;
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
      unbalancedSamples: followSamples.filter((s) => s.len > 0 && !s.balanced).length,
      samples: followSamples,
    };
  }

  return {
    name: spec.name,
    prompt: spec.prompt,
    status: errors.length === 0 && (followUpResult?.status ?? "pass") === "pass" ? "pass" : "fail",
    errors,
    durationMs: Date.now() - t0,
    finalText,
    unbalancedSamples,
    samples,
    followUp: followUpResult,
    interrupt: interruptResult,
  };
}

async function main() {
  if (!USER_TOKEN) {
    console.error(
      "SLACK_USER_TOKEN missing in .env — run `pnpm exec tsx e2e/grab-user-token.ts` first.",
    );
    process.exit(1);
  }

  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = join(RESULTS_DIR, stamp);
  mkdirSync(runDir, { recursive: true });

  const results: CaseResult[] = [];
  for (const spec of CASES) {
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
        if (r.followUp.errors.length) console.log("      " + r.followUp.errors.join("\n      "));
      }
      if (r.interrupt) {
        console.log(
          `    ↳ interrupt  first_len=${r.interrupt.firstReplyText?.length ?? 0}  second_len=${r.interrupt.secondReplyText?.length ?? 0}`,
        );
        if (r.interrupt.errors.length) console.log("      " + r.interrupt.errors.join("\n      "));
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
  console.log(`\n${pass}/${results.length} cases passed. Report: ${runDir}/report.json`);
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
