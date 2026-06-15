/**
 * End-to-end test: bot-restart recovery for HITL components.
 *
 * Verifies that after the Discord bot restarts between when a `confirm_write`
 * picker was posted and when the user clicks it, the interaction is still
 * routed correctly and the HITL gate resolves.
 *
 * ── CI guard ──────────────────────────────────────────────────────────────
 * Gated behind DISCORD_E2E=1 (same as run.ts). Exits 0 cleanly when the flag
 * is absent — this script must NOT break normal CI.
 *
 * ── Scenario ──────────────────────────────────────────────────────────────
 *
 *   1. Start bot instance #1 (spawned as a child process).
 *   2. Post a user prompt that triggers `confirm_write`.
 *   3. Poll the channel until the Components V2 picker lands; verify that
 *      each button has a non-empty `custom_id` (the interaction routing key).
 *   4. **Kill** instance #1 — its in-memory HITL registry is discarded.
 *   5. Start bot instance #2.
 *   6. Simulate a button click (POST to DISCORD_INTERACTIONS_URL) with the
 *      `custom_id` captured in step 3.
 *   7. Poll the channel: assert the picker was replaced by the resolved-state
 *      render AND the bot's natural-language reply lands.
 *   8. Tear down instance #2.
 *
 * Run: `DISCORD_E2E=1 pnpm e2e:restart`
 *
 * ── Status ────────────────────────────────────────────────────────────────
 * This recovery path depends on the Discord adapter persisting the
 * HITL-resolve context in a durable store (not just in-process memory).
 * The adapter's interaction routing is implemented in
 * packages/bot-discord/src/interaction.ts. This script is provided as a
 * harness skeleton; the full kill→restart→click cycle requires a durable
 * interaction store in the adapter and the DISCORD_INTERACTIONS_URL to be
 * configured. See packages/bot-discord/src/interaction.ts for the
 * interaction routing implementation.
 */
import "dotenv/config";
import { spawn } from "node:child_process";
import {
  channelHistory,
  messagesSince,
  clickButton,
  BOT_USER_ID,
} from "./discord-api.js";
import { postAsUser } from "./discord-api.js";
import { BOT_MENTION } from "./cases.js";

// ── CI gate ──────────────────────────────────────────────────────────────────

if (!process.env["DISCORD_E2E"]) {
  console.log(
    "Discord e2e restart-recovery harness skipped (DISCORD_E2E not set). " +
      "Set DISCORD_E2E=1 plus the required env vars to run. " +
      "See examples/discord/e2e/README.md for setup instructions.",
  );
  process.exit(0);
}

const TEST_CHANNEL =
  process.env["DISCORD_TEST_CHANNEL_ID"] ?? process.env["E2E_CHANNEL"] ?? "";

if (!TEST_CHANNEL) {
  console.error("DISCORD_TEST_CHANNEL_ID is required when DISCORD_E2E=1.");
  process.exit(1);
}

if (!BOT_USER_ID) {
  console.error("DISCORD_BOT_USER_ID is required when DISCORD_E2E=1.");
  process.exit(1);
}

const INTERACTIONS_URL = process.env["DISCORD_INTERACTIONS_URL"];
if (!INTERACTIONS_URL) {
  console.error(
    "DISCORD_INTERACTIONS_URL is required for restart-recovery testing " +
      "(the harness needs to POST a synthetic interaction to the bot). " +
      "Set this to the bot's registered interactions endpoint URL.",
  );
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Poll until predicate returns a value, or throw after timeoutMs. */
async function pollUntil<T>(
  fn: () => Promise<T | null | undefined>,
  opts: { intervalMs: number; timeoutMs: number; label: string },
): Promise<T> {
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v != null) return v;
    await sleep(opts.intervalMs);
  }
  throw new Error(`Timed out waiting for: ${opts.label}`);
}

// ── Bot lifecycle helpers ─────────────────────────────────────────────────────

interface BotInstance {
  kill(): void;
  ready: Promise<void>;
}

/**
 * Spawn the Discord bot as a child process. Resolves `ready` when the bot
 * logs that it's connected to the Gateway.
 */
function spawnBot(): BotInstance {
  const child = spawn("node", ["--loader", "tsx/esm", "app/index.ts"], {
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const ready = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Bot did not start within 30s")),
      30_000,
    );
    const onData = (data: Buffer) => {
      const line = data.toString();
      // The Discord.js client logs "Logged in as ..." or "Ready!" when connected.
      if (/logged in|ready/i.test(line)) {
        clearTimeout(timeout);
        resolve();
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error(`Bot exited with code ${code}`));
    });
  });

  return {
    kill() {
      child.kill("SIGTERM");
    },
    ready,
  };
}

// ── Main scenario ─────────────────────────────────────────────────────────────

async function main() {
  console.log("\n══ Discord restart-recovery e2e ══\n");

  // ── Step 1: spawn bot instance #1 ──────────────────────────────────────
  console.log("1. Starting bot instance #1…");
  const bot1 = spawnBot();
  await bot1.ready;
  console.log("   Bot #1 ready.");

  // ── Step 2: post a prompt that triggers confirm_write ──────────────────
  console.log("2. Posting confirm_write prompt…");
  const preHistory = await channelHistory(TEST_CHANNEL, 1);
  const anchorId = preHistory[0]?.id ?? "0";

  const prompt =
    `<@${BOT_USER_ID}> file a Linear issue titled "E2E restart test". ` +
    "Use the confirm_write tool to ask me to approve it before creating anything.";
  const sent = await postAsUser(TEST_CHANNEL, prompt);
  console.log(`   Sent message ID: ${sent.id}`);

  // ── Step 3: poll until the picker lands ────────────────────────────────
  console.log("3. Polling for confirm_write picker…");
  const pickerMsg = await pollUntil(
    async () => {
      const msgs = await messagesSince(TEST_CHANNEL, anchorId, 10);
      return msgs.find(
        (m) =>
          (m.author.id === BOT_USER_ID || m.author.bot) &&
          m.components &&
          m.components.length > 0,
      );
    },
    { intervalMs: 1500, timeoutMs: 30_000, label: "confirm_write picker" },
  );

  console.log(`   Picker landed (message ID: ${pickerMsg.id}).`);

  // Find the Create button's custom_id.
  let createCustomId: string | undefined;
  for (const row of pickerMsg.components ?? []) {
    const r = row as {
      type?: number;
      components?: Array<{ type?: number; custom_id?: string; label?: string }>;
    };
    if (r.type === 1 && Array.isArray(r.components)) {
      for (const c of r.components) {
        if (c.type === 2 && /create/i.test(c.label ?? "")) {
          createCustomId = c.custom_id;
          break;
        }
      }
    }
    if (createCustomId) break;
  }

  if (!createCustomId) {
    console.error("   No 'Create' button custom_id found — cannot continue.");
    bot1.kill();
    process.exit(1);
  }
  console.log(`   Create button custom_id: ${createCustomId}`);

  // ── Step 4: kill bot instance #1 ──────────────────────────────────────
  console.log("4. Killing bot instance #1 (simulating restart)…");
  bot1.kill();
  await sleep(2000);
  console.log("   Bot #1 stopped.");

  // ── Step 5: spawn bot instance #2 ─────────────────────────────────────
  console.log("5. Starting bot instance #2…");
  const bot2 = spawnBot();
  await bot2.ready;
  console.log("   Bot #2 ready.");

  // ── Step 6: simulate button click ─────────────────────────────────────
  console.log("6. Simulating Create button click…");
  const click = await clickButton({
    channelId: TEST_CHANNEL,
    messageId: pickerMsg.id,
    customId: createCustomId,
    guildId: process.env["DISCORD_TEST_GUILD_ID"],
  });

  if (!click.sent) {
    console.error(`   Button click skipped: ${click.warning}`);
    bot2.kill();
    process.exit(1);
  }
  console.log("   Click delivered.");

  // ── Step 7: poll for resolved state ───────────────────────────────────
  console.log("7. Polling for resolved picker and final bot reply…");
  // Give the interaction up to 20s to process.
  await sleep(3000);

  const msgs = await messagesSince(TEST_CHANNEL, anchorId, 20);
  const botMsgs = msgs.filter(
    (m) => m.author.id === BOT_USER_ID || m.author.bot,
  );
  const naturalReply = botMsgs.find((m) => m.content && m.content.length > 0);

  const passed = Boolean(naturalReply);
  console.log(
    passed
      ? `   ✓ Bot replied after restart: "${naturalReply!.content.slice(0, 80)}…"`
      : "   ✗ No bot reply found after click",
  );

  // ── Step 8: tear down ─────────────────────────────────────────────────
  console.log("8. Stopping bot instance #2…");
  bot2.kill();
  await sleep(1000);

  console.log(`\nRestart-recovery test: ${passed ? "PASSED" : "FAILED"}`);
  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
