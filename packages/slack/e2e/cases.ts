/**
 * Catalog of real end-to-end test cases the harness sends as live Slack
 * messages and samples back via the Slack API while the bot streams.
 *
 * Each case is technical-axis-flavoured (not product-flavoured) — the
 * prompt is just whatever phrasing reliably triggers the dimension we
 * want to measure.
 *
 * Fields:
 *   name              human-readable label
 *   prompt            user's message text — what gets sent in #ag-ui-bot-test
 *   sampleIntervalMs  how often to poll the bot's reply during streaming
 *   maxWaitMs         give up sampling after this long
 *   screenshots       sample times (ms after send) to take mid-stream
 *                     screenshots in the Slack web UI
 *   expectations      checks to run on the final text
 *
 * Add cases liberally. The catalog itself is the test surface.
 */

export interface E2ECase {
  name: string;
  prompt: string;
  sampleIntervalMs?: number;
  maxWaitMs?: number;
  screenshots?: number[];
  /**
   * Optional follow-up turn that gets sent INTO the thread that this case's
   * first prompt creates. Used to test thread-continuation without
   * re-mentioning the bot. The follow-up has its own prompt + expectations
   * and reuses the same sampleIntervalMs / maxWaitMs.
   */
  followUp?: {
    prompt: string;
    expectations?: E2ECase["expectations"];
  };
  /**
   * Mid-stream interrupt: send a second user message into the SAME thread
   * `afterMs` after kicking off the first prompt. Used to verify that the
   * in-flight bot reply is aborted, marked as interrupted in Slack, and
   * the new turn produces a fresh reply.
   */
  interrupt?: {
    afterMs: number;
    prompt: string;
    /** Expectations applied to the interrupted FIRST reply. */
    firstExpectations?: E2ECase["expectations"];
    /** Expectations applied to the new (second) reply. */
    expectations?: E2ECase["expectations"];
  };
  expectations?: {
    /** Bot's final response must contain these substrings (case-insensitive). */
    finalContains?: string[];
    /** Bot's final response must NOT contain these. */
    finalNotContains?: string[];
    /** Final mrkdwn must be balanced (no dangling brackets). */
    balancedBrackets?: boolean;
    /** Minimum reply length in chars (catches truncation regressions). */
    minLength?: number;
    /**
     * Verifies the final text contains a monospace table whose rows all
     * have the same line length — i.e. columns are aligned, not pipe-soup.
     */
    monospaceAlignedTable?: boolean;
    /**
     * Counts how many distinct Slack messages this case produced (after
     * the bot's parent message). Used to verify chunking-keeps-whole-block
     * behaviour: a long fenced block should land in one message, not split.
     */
    expectedChunkCount?: number;
    /**
     * Custom predicate run against the *full* set of bot replies in the
     * thread (NOT just the first one). Useful for asserting properties
     * across chunked output, e.g. "the fence opener appears at the start
     * of exactly one message" or "no message text contains a dangling ```".
     */
    /**
     * Custom predicate. `replies` is the bot's per-message text array;
     * `raw` is the full Slack message objects (with `blocks`, `ts`, etc.)
     * for cases that need to inspect Block Kit structure.
     */
    perReplyChecks?: (
      replies: string[],
      raw: Array<Record<string, any>>,
    ) => string[];
  };
}

export const CASES: E2ECase[] = [
  // ── A. Trigger surface ──────────────────────────────────────────────
  {
    name: "A1 — top-level @mention",
    prompt: "<@U0B45V75NNR> say HOTEL in one short sentence",
    expectations: { finalContains: ["HOTEL"], minLength: 5 },
  },
  // /agent slash command requires a real slash-command invocation —
  // can't fire it via chat.postMessage. Manual-only for now.
  // {
  //   name: "A10 — /agent slash command",
  //   prompt: "/agent ping reply with the word PONG",
  //   expectations: { finalContains: ["PONG"], minLength: 4 },
  // },

  // ── B. Response length / shape ─────────────────────────────────────
  {
    name: "B2 — single-token response (was the ECHO/AL bug)",
    prompt: "<@U0B45V75NNR> reply with exactly the word ECHO and nothing else",
    expectations: {
      finalContains: ["ECHO"],
      finalNotContains: ["…"],
      minLength: 4,
    },
  },
  {
    name: "B6 — long response, multi-paragraph",
    prompt:
      "<@U0B45V75NNR> write 4 paragraphs about the history of the printing press. Take your time. Be detailed.",
    sampleIntervalMs: 700,
    maxWaitMs: 60_000,
    screenshots: [1500, 3500, 7000, 14_000],
    expectations: { minLength: 800, balancedBrackets: true },
  },
  {
    name: "B7 — long response (model-bounded; ensures balanced + reasonable length)",
    prompt:
      "<@U0B45V75NNR> write a thorough 8-paragraph essay about agent protocols. " +
      "Each paragraph 4-6 sentences. Be detailed, no apologies.",
    sampleIntervalMs: 700,
    maxWaitMs: 90_000,
    screenshots: [2000, 5000, 12_000, 20_000],
    // Lower floor — the chunking code is exercised by the unit tests; here
    // we mainly want to see balanced streaming over a long emission.
    expectations: { minLength: 1500, balancedBrackets: true },
  },

  // ── B/markdown — mrkdwn translation ───────────────────────────────
  {
    name: "B11 — bold/italic markers",
    prompt:
      "<@U0B45V75NNR> say a sentence with one **bold** word and one *italic* word. Use those exact markdown markers.",
    expectations: {
      // After mrkdwn translation: bold uses `*`, italic uses `_`
      finalContains: ["*", "_"],
      finalNotContains: ["**"],
      balancedBrackets: true,
    },
  },
  {
    name: "B13 — bullet list",
    prompt:
      "<@U0B45V75NNR> list three programming languages as bullet points using `-` markers.",
    expectations: {
      finalContains: ["•"], // mrkdwn bullets
      balancedBrackets: true,
    },
  },
  {
    name: "B16 — fenced code block",
    prompt:
      "<@U0B45V75NNR> show me a short python snippet for a fibonacci function in a fenced code block",
    sampleIntervalMs: 700,
    maxWaitMs: 60_000,
    screenshots: [1500, 4000, 9000],
    expectations: {
      // The point: while streaming, the in-flight Slack message has an
      // OPEN fence; auto-close keeps the rest of the message renderable.
      finalContains: ["```"],
      balancedBrackets: true, // dangling ``` would fail this
    },
  },
  {
    name: "B17 — table fallback to monospace, COLUMN-ALIGNED",
    prompt:
      "<@U0B45V75NNR> give me a 3-row markdown table comparing langgraph, ag-ui, and copilotkit (columns: name, role)",
    expectations: {
      finalContains: ["```", "langgraph", "ag-ui"],
      balancedBrackets: true,
      monospaceAlignedTable: true,
    },
  },
  {
    name: "B-chunk-spill — long fenced block should land WHOLE in one Slack message",
    prompt:
      "<@U0B45V75NNR> write a self-contained python script that defines 8 small utility functions in ONE fenced code block. Do not split it. Aim for 1500-2500 chars inside the block.",
    sampleIntervalMs: 800,
    maxWaitMs: 90_000,
    expectations: {
      finalContains: ["```python", "def "],
      balancedBrackets: true,
      perReplyChecks: (replies) => {
        const errs: string[] = [];
        // Among all messages, exactly one should contain ```python (the block).
        const withPython = replies.filter((r) =>
          r.includes("```python"),
        ).length;
        if (withPython !== 1) {
          errs.push(
            `expected exactly 1 message containing \`\`\`python; got ${withPython}`,
          );
        }
        // No message should END inside an open fence (autoCloseOpenMarkdown should
        // close it, OR the boundary should have moved before the fence opener).
        for (let i = 0; i < replies.length; i++) {
          const r = replies[i] ?? "";
          const fences = (r.match(/```/g) ?? []).length;
          if (fences % 2 !== 0) {
            errs.push(`message #${i} has unbalanced fences`);
          }
        }
        return errs;
      },
    },
  },

  // ── C. Streaming dynamics ─────────────────────────────────────────
  {
    name: "C-stream-1 — mid-stream bracket polish (open fence)",
    prompt:
      "<@U0B45V75NNR> describe how python decorators work using ```python ... ``` blocks. Be thorough.",
    sampleIntervalMs: 500,
    maxWaitMs: 60_000,
    screenshots: [1000, 2500, 6000, 12_000],
    expectations: { finalContains: ["```python"], balancedBrackets: true },
  },

  // ── D. Conversation state ─────────────────────────────────────────
  {
    name: "D-state-1 — thread continuation without re-mention",
    prompt: "<@U0B45V75NNR> say the single word ALPHA",
    expectations: { finalContains: ["ALPHA"] },
    followUp: {
      prompt:
        "now say the single word BRAVO. no @mention; just reply in this thread.",
      expectations: { finalContains: ["BRAVO"] },
    },
  },

  // ── Interrupt: reply mid-stream cancels the in-flight bot reply ──
  {
    name: "Interrupt — reply mid-stream cancels the in-flight bot reply",
    prompt:
      "<@U0B45V75NNR> write a really long, slow, 6-paragraph essay about agent protocols. " +
      "Take your time. Be exhaustive.",
    sampleIntervalMs: 700,
    maxWaitMs: 30_000,
    interrupt: {
      afterMs: 3500,
      prompt: "actually never mind. just say PONG and nothing else.",
      // The first (interrupted) reply must carry the marker.
      firstExpectations: {
        finalContains: ["(interrupted)"],
      },
      // The new reply must contain the new word.
      expectations: {
        finalContains: ["PONG"],
        minLength: 4,
      },
    },
  },

  // ── E. Frontend tools & context ───────────────────────────────────
  // Note: the showcase `beautiful_chat` agent has a strong "1-2 sentences"
  // system prompt that overrides our nudge toward proactively calling tools,
  // so E-tag-1 directs the tool use explicitly. E-context-1 verifies the
  // context entries themselves arrive at the LLM.
  {
    name: "E-tag-1 — agent uses lookup_slack_user to tag Atai in its reply",
    prompt:
      '<@U0B45V75NNR> call the lookup_slack_user tool with query "atai" to get my ' +
      "real Slack user ID, then reply with a friendly greeting that uses the returned " +
      '`mention` string verbatim to tag me. Don\'t just write "Atai" as text.',
    sampleIntervalMs: 700,
    maxWaitMs: 30_000,
    expectations: {
      // The agent's reply must contain a real <@USERID> mention for Atai.
      // U0FF2X1XXXX is just a sanity-check pattern; the real test is the
      // perReplyChecks below.
      perReplyChecks: (replies) => {
        const errs: string[] = [];
        const joined = replies.join("\n");
        // 1. Some <@U…> mention appears.
        if (!/<@U[A-Z0-9]+>/.test(joined)) {
          errs.push("no <@USERID> mention found in any bot reply");
        }
        // 2. No literal "@atai" text without the angle-bracket syntax
        //    (would mean the agent didn't use the tool).
        if (/\B@atai\b/i.test(joined.replace(/<@[UW][A-Z0-9]+>/g, ""))) {
          errs.push("bot wrote `@atai` plaintext instead of using <@USERID>");
        }
        return errs;
      },
    },
  },
  {
    name: "E-component-1 — agent renders a Slack component as a Block Kit card",
    prompt:
      "<@U0B45V75NNR> use the greeting_card component to render a fancy greeting " +
      'for Atai with the message "welcome to the showcase!" and the :wave: emoji.',
    sampleIntervalMs: 700,
    maxWaitMs: 30_000,
    expectations: {
      // The component posts a separate blocks message in the thread. Our
      // harness reads via conversations.replies which includes block-only
      // messages — we just need at least one bot reply whose text matches
      // the fallback string (which Slack also stores on blocks messages).
      perReplyChecks: (replies) => {
        const errs: string[] = [];
        const joined = replies.join("\n");
        // The fallback contains the recipient + message verbatim.
        if (!joined.toLowerCase().includes("welcome to the showcase")) {
          errs.push("no bot reply contained the component's fallback text");
        }
        return errs;
      },
    },
  },
  {
    name: "E-restart-1 — interrupt picker has resume values encoded in button.value (survives bridge restart)",
    // Triggers an interrupt; once the picker lands, we read it back via
    // conversations.replies and verify every time-slot button carries a
    // JSON-encoded resume payload in its `value` field. That's what
    // Slack stores, and what the bridge would decode on a "stale click"
    // after a restart — proves the structural recovery story.
    prompt:
      "<@U0B45V75NNR> please book a 1:1 with Alice next week to review Q2 goals.",
    sampleIntervalMs: 700,
    maxWaitMs: 15_000,
    expectations: {
      perReplyChecks: (replies, raw) => {
        const errs: string[] = [];
        const pickerMsg = raw.find((m) =>
          (m.blocks ?? []).some((b: { type?: string }) => b.type === "header"),
        );
        if (!pickerMsg) {
          errs.push("never posted a picker message");
          return errs;
        }
        const buttons: Array<{ action_id?: string; value?: string }> = [];
        for (const b of pickerMsg.blocks ?? []) {
          if (b.type === "actions" && Array.isArray(b.elements)) {
            for (const el of b.elements) {
              if (el?.type === "button") buttons.push(el);
            }
          }
        }
        if (buttons.length < 3) {
          errs.push(`expected ≥3 time-slot buttons; got ${buttons.length}`);
        }
        for (const btn of buttons) {
          if (!btn.value) {
            errs.push(`button action_id=${btn.action_id} has no value field`);
            continue;
          }
          try {
            const decoded = JSON.parse(btn.value);
            const text = decoded;
            // The picker buttons bind either {chosen_time, chosen_label}
            // or {cancelled: true}. Both shapes verify the round-trip.
            const ok =
              (text &&
                typeof text === "object" &&
                "chosen_time" in text &&
                "chosen_label" in text) ||
              (text && typeof text === "object" && "cancelled" in text);
            if (!ok) {
              errs.push(
                `button action_id=${btn.action_id} decoded to unexpected shape: ${btn.value}`,
              );
            }
          } catch (e) {
            errs.push(
              `button action_id=${btn.action_id} value isn't valid JSON: ${(e as Error).message}`,
            );
          }
        }
        return errs;
      },
    },
  },
  {
    name: "E-hitl-1 — agent renders an interactive HITL Block Kit message",
    // Verifies the human-in-the-loop component renders into the thread. We
    // can't simulate the button click via Slack's API, so this case only
    // asserts that the Block Kit message lands; the click→resolve flow
    // is covered by unit tests in src/__tests__/human-in-the-loop.test.ts.
    // Note: the agent's run will be left dangling on the HITL wait for
    // up to 5 min (the component's timeoutMs) — that's accepted here.
    prompt:
      "<@U0B45V75NNR> use the confirm component to ask me whether to proceed " +
      "with deleting all my files. Use exactly the question 'Proceed with deleting all files?'",
    sampleIntervalMs: 700,
    maxWaitMs: 12_000,
    expectations: {
      perReplyChecks: (replies) => {
        const errs: string[] = [];
        const joined = replies.join("\n");
        // The HITL fallback for our confirm component is "Confirm: <question>".
        if (!joined.toLowerCase().includes("confirm:")) {
          errs.push(
            "no bot reply contained the HITL fallback 'Confirm:' prefix",
          );
        }
        return errs;
      },
    },
  },
  {
    name: "E-context-1 — Slack-usage context is delivered to the LLM",
    // Asks the agent to quote from its App Context. If `runAgent({context})` is
    // plumbed through and the CopilotKit middleware injects it as a system
    // message, the agent will quote a recognisable phrase from
    // slackUsageContext. If context isn't being plumbed, the agent has no
    // way to know the exact wording.
    prompt:
      "<@U0B45V75NNR> in one short line: what does your App Context tell you " +
      "about how to @-mention people on Slack? Quote the most relevant sentence verbatim.",
    sampleIntervalMs: 700,
    maxWaitMs: 20_000,
    expectations: {
      // Any phrase that appears verbatim in slackUsageContext is fine —
      // the only way the LLM could quote these strings is from the
      // context entries actually being delivered.
      perReplyChecks: (replies) => {
        const joined = replies.join("\n");
        const witnesses = [
          "<@USERID>",
          "lookup_slack_user",
          "<@U05PN5700P9>",
          "@-mention",
        ];
        if (witnesses.some((w) => joined.includes(w))) return [];
        return [
          `final reply quoted no context phrase from ${JSON.stringify(witnesses)}`,
        ];
      },
    },
  },

  // ── F. Loop / echo / subtype filters ──────────────────────────────
  {
    name: "F-edit — editing a previous message must NOT re-trigger",
    prompt: "<@U0B45V75NNR> please respond just ONCE and stop",
    // The harness edits the just-sent message and verifies bot does not produce a second reply.
    expectations: { minLength: 2 },
  },
];
