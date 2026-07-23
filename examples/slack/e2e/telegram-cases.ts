/**
 * Catalog of end-to-end test cases for the Telegram bot harness.
 *
 * Each case describes a prompt to send and expectations to assert on the
 * bot's reply. The shape mirrors `examples/slack/e2e/cases.ts` with
 * Telegram-specific adaptations:
 *
 *   - No Block Kit assertions (Telegram uses HTML/MarkdownV2 rendering).
 *   - No Slack mrkdwn format (`*bold*` → Telegram uses `**bold**` before
 *     the HTML converter, or `<b>` after).
 *   - No @mention syntax in prompts (Telegram uses @username or /commands).
 *   - Bullet list assertion checks for `•` or `-` markers in plain text
 *     (not Slack's translated `•`).
 *
 * Fields:
 *   name              human-readable label
 *   prompt            text to send (operator pastes this or sender-bot posts it)
 *   sampleIntervalMs  how often to poll for the bot's reply
 *   maxWaitMs         give up after this long (default 30 s)
 *   expectations      checks on the final reply text
 *   followUp          optional second turn in the same thread
 */

export interface E2ECase {
  name: string;
  prompt: string;
  sampleIntervalMs?: number;
  maxWaitMs?: number;
  /**
   * Optional follow-up turn: after the first reply lands, this prompt is
   * sent into the same reply chain. Used to test conversation continuity.
   * In the manual-trigger flow the operator sends this second prompt too;
   * in automated mode the sender bot posts it as a reply to the bot's
   * previous message.
   */
  followUp?: {
    prompt: string;
    expectations?: E2ECase["expectations"];
  };
  expectations?: {
    /** Bot's final reply must contain all of these substrings (case-insensitive). */
    finalContains?: string[];
    /** Bot's final reply must NOT contain any of these. */
    finalNotContains?: string[];
    /** Final text must have balanced code fences and backticks. */
    balancedBrackets?: boolean;
    /** Minimum reply length in characters (catches truncation regressions). */
    minLength?: number;
    /**
     * Custom predicate run against all bot messages collected for this case.
     * `replies` is the array of text strings; return an array of error
     * strings (empty = pass).
     */
    perReplyChecks?: (replies: string[]) => string[];
  };
}

export const CASES: E2ECase[] = [
  // ── A. Basic response ──────────────────────────────────────────────────────
  {
    name: "A1 — single-word echo",
    // Confirms the bot responds and loop-guard doesn't swallow the reply.
    prompt: "Reply with exactly the word HOTEL and nothing else",
    expectations: {
      finalContains: ["HOTEL"],
      minLength: 5,
    },
  },
  {
    name: "A2 — single-token response (regression: was ECHO/AL truncation bug)",
    prompt: "Reply with exactly the word ECHO and nothing else",
    expectations: {
      finalContains: ["ECHO"],
      finalNotContains: ["…"],
      minLength: 4,
    },
  },

  // ── B. Response length / shape ─────────────────────────────────────────────
  {
    name: "B1 — multi-paragraph prose",
    prompt:
      "Write 4 paragraphs about the history of the printing press. " +
      "Take your time. Be detailed.",
    sampleIntervalMs: 1000,
    maxWaitMs: 60_000,
    expectations: {
      minLength: 600,
      balancedBrackets: true,
    },
  },
  {
    name: "B2 — long response balanced fences",
    prompt:
      "Write a thorough 6-paragraph essay about agent protocols. " +
      "Each paragraph 4-6 sentences. Be detailed, no apologies.",
    sampleIntervalMs: 1000,
    maxWaitMs: 90_000,
    expectations: {
      minLength: 1000,
      balancedBrackets: true,
    },
  },

  // ── B/markdown — Telegram formatting ──────────────────────────────────────
  {
    name: "B11 — fenced code block (Python snippet)",
    // Confirms the LLM emits a fenced block and the bot doesn't corrupt it.
    prompt:
      "Show me a short Python snippet for a Fibonacci function in a fenced code block.",
    sampleIntervalMs: 700,
    maxWaitMs: 45_000,
    expectations: {
      finalContains: ["```"],
      balancedBrackets: true,
    },
  },
  {
    name: "B12 — bullet list",
    prompt:
      "List three programming languages as bullet points using - markers.",
    expectations: {
      perReplyChecks: (replies) => {
        const joined = replies.join("\n");
        // Expect at least one line starting with "-" or "•"
        const hasBullets = /^[-•]/m.test(joined);
        if (!hasBullets) {
          return ["no bullet-point line found in bot reply"];
        }
        return [];
      },
      balancedBrackets: true,
    },
  },

  // ── C. Triage / agentic prompts ────────────────────────────────────────────
  {
    name: "C1 — triage prompt (structured summary expected)",
    // Core use-case for the on-call triage bot.
    prompt: "Triage my open issues and give me a structured summary.",
    sampleIntervalMs: 1000,
    maxWaitMs: 60_000,
    expectations: {
      // The bot should produce a non-trivial response.
      minLength: 100,
      balancedBrackets: true,
    },
  },
  {
    name: "C2 — render table prompt (text/markdown table expected)",
    // Unlike Slack (which renders a monospace-aligned table in a code fence),
    // Telegram may emit a plain markdown table or a pre-formatted block.
    // We assert the key names appear in the output and fences are balanced.
    prompt:
      "Give me a 3-row table comparing LangGraph, AG-UI, and CopilotKit " +
      "(columns: name, role). Use plain text or a code block.",
    expectations: {
      finalContains: ["langgraph", "ag-ui", "copilotkit"],
      balancedBrackets: true,
    },
  },

  // ── D. Conversation continuity ─────────────────────────────────────────────
  {
    name: "D1 — thread continuation (two-turn conversation)",
    // Sends a first prompt, then a follow-up in the same reply chain.
    prompt: "Say the single word ALPHA",
    expectations: { finalContains: ["ALPHA"] },
    followUp: {
      prompt: "Now say the single word BRAVO.",
      expectations: { finalContains: ["BRAVO"] },
    },
  },
];
