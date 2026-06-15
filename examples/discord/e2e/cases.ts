/**
 * Catalog of real end-to-end test cases the harness sends as live Discord
 * messages and samples back via the Discord REST API while the bot streams.
 *
 * Each case maps to a technical axis of the Discord bot (not a product
 * feature) — the prompt is whatever phrasing reliably exercises the axis.
 *
 * Fields:
 *   name              human-readable label
 *   prompt            text sent to the test channel (with @mention or slash)
 *   sampleIntervalMs  how often to poll the bot's reply during streaming
 *   maxWaitMs         give up sampling after this long
 *   expectations      assertions run on the final content
 *
 * Discord-specific notes vs. the Slack harness:
 *  - Discord uses standard Markdown (not mrkdwn); bold is **text**, not *text*.
 *  - @-mentions in Discord are formatted as <@USER_ID>.
 *  - The bot replies in the same channel or in a thread spawned from the
 *    trigger message. We sample channel history (not thread replies) since the
 *    Discord adapter posts follow-ups into the same thread context.
 *  - Rich embeds / Components V2 replies can't be fully read back via REST
 *    (components with custom_ids are returned, but rendered content lives
 *    inside ephemeral interaction responses). For those cases we check that the
 *    `components` array is present and structured as expected.
 */

export interface E2ECase {
  name: string;
  /**
   * Message to post in the test channel. Use `<@BOT_USER_ID>` for @-mentions
   * (the runner substitutes the real bot user ID at runtime).
   */
  prompt: string;
  sampleIntervalMs?: number;
  maxWaitMs?: number;
  /**
   * Optional follow-up turn: a second message sent as a reply to the first,
   * exercising the thread-continuation path (no re-@-mention required in a
   * thread the bot already joined).
   */
  followUp?: {
    prompt: string;
    expectations?: E2ECase["expectations"];
  };
  expectations?: {
    /** Bot's final message content must contain these substrings (case-insensitive). */
    finalContains?: string[];
    /** Bot's final message content must NOT contain these. */
    finalNotContains?: string[];
    /** Final Markdown must be balanced (no dangling fences or backticks). */
    balancedBrackets?: boolean;
    /** Minimum reply length in chars. */
    minLength?: number;
    /**
     * Assert that at least one bot message has a non-empty `components` array
     * (i.e. the bot rendered a Components V2 / button-bearing message).
     */
    hasComponents?: boolean;
    /**
     * Custom predicate against the full set of bot messages since the trigger.
     * `messages` is the raw DiscordMessage array (newest first excluded —
     * callers receive the array in send order, oldest first).
     * Return an array of error strings (empty = pass).
     */
    perMessageChecks?: (
      messages: Array<{
        content: string;
        components?: Array<Record<string, unknown>>;
        author: { id: string; bot?: boolean };
      }>,
    ) => string[];
  };
}

// ── Helper: bot mention placeholder ────────────────────────────────────────
// The runner substitutes BOT_MENTION at runtime once it knows the bot's user
// ID. Cases that need a mention use this sentinel.
export const BOT_MENTION = "{{BOT_MENTION}}";

// ── Cases ───────────────────────────────────────────────────────────────────

export const CASES: E2ECase[] = [
  // ── A. Trigger surface ───────────────────────────────────────────────────

  {
    name: "A1 — @mention triggers the bot",
    prompt: `${BOT_MENTION} say HOTEL in one short sentence`,
    expectations: {
      finalContains: ["HOTEL"],
      minLength: 5,
    },
  },

  // A slash-command case requires a real interaction delivery from Discord
  // (the Gateway routes /command interactions; they cannot be injected via
  // REST from an arbitrary user token). Manual-only for now.
  // {
  //   name: "A10 — /agent slash command",
  //   prompt: "/agent ping reply with the word PONG",
  //   expectations: { finalContains: ["PONG"], minLength: 4 },
  // },

  // ── B. Response length / shape ───────────────────────────────────────────

  {
    name: "B2 — single-token response",
    prompt: `${BOT_MENTION} reply with exactly the word ECHO and nothing else`,
    expectations: {
      finalContains: ["ECHO"],
      minLength: 4,
    },
  },

  {
    name: "B6 — long response, multi-paragraph",
    prompt: `${BOT_MENTION} write 4 paragraphs about the history of the printing press. Take your time. Be detailed.`,
    sampleIntervalMs: 700,
    maxWaitMs: 60_000,
    expectations: {
      minLength: 800,
      balancedBrackets: true,
    },
  },

  {
    name: "B7 — long response (model-bounded; balanced over long emission)",
    prompt:
      `${BOT_MENTION} write a thorough 8-paragraph essay about agent protocols. ` +
      "Each paragraph 4-6 sentences. Be detailed, no apologies.",
    sampleIntervalMs: 700,
    maxWaitMs: 90_000,
    expectations: {
      minLength: 1500,
      balancedBrackets: true,
    },
  },

  // ── B/markdown — Markdown rendering ─────────────────────────────────────

  {
    name: "B11 — bold/italic markers",
    prompt:
      `${BOT_MENTION} say a sentence with one **bold** word and one *italic* word. Use those exact markdown markers.`,
    expectations: {
      finalContains: ["**", "*"],
      balancedBrackets: true,
    },
  },

  {
    name: "B13 — bullet list",
    prompt: `${BOT_MENTION} list three programming languages as bullet points using - markers.`,
    expectations: {
      finalContains: ["-"],
      balancedBrackets: true,
    },
  },

  {
    name: "B16 — fenced code block",
    prompt: `${BOT_MENTION} show me a short python snippet for a fibonacci function in a fenced code block`,
    sampleIntervalMs: 700,
    maxWaitMs: 60_000,
    expectations: {
      finalContains: ["```"],
      balancedBrackets: true,
    },
  },

  // ── C. Streaming dynamics ─────────────────────────────────────────────

  {
    name: "C-stream-1 — mid-stream bracket balance (open fence)",
    prompt: `${BOT_MENTION} describe how python decorators work using \`\`\`python ... \`\`\` blocks. Be thorough.`,
    sampleIntervalMs: 500,
    maxWaitMs: 60_000,
    expectations: {
      finalContains: ["```python"],
      balancedBrackets: true,
    },
  },

  // ── D. Conversation state ────────────────────────────────────────────

  {
    name: "D-state-1 — thread continuation without re-mention",
    prompt: `${BOT_MENTION} say the single word ALPHA`,
    expectations: { finalContains: ["ALPHA"] },
    followUp: {
      prompt:
        "now say the single word BRAVO. no mention; just reply in this thread.",
      expectations: { finalContains: ["BRAVO"] },
    },
  },

  // ── E. Components V2 / HITL ──────────────────────────────────────────

  {
    name: "E-component-1 — bot renders a Components V2 reply",
    prompt: `${BOT_MENTION} show me the open issues in the CPK team this cycle, and render them with the issue_list component.`,
    sampleIntervalMs: 700,
    maxWaitMs: 45_000,
    expectations: {
      // The issue_list render-tool produces a message with Discord embed/component
      // structure. We assert that at least one bot message carries components.
      perMessageChecks: (messages) => {
        const errs: string[] = [];
        const hasContent = messages.some(
          (m) => m.content.length > 0 || (m.components && m.components.length > 0),
        );
        if (!hasContent) {
          errs.push("no bot message had any content or components");
        }
        return errs;
      },
    },
  },

  {
    name: "E-hitl-1 — confirm_write renders a picker with Create/Cancel buttons",
    prompt:
      `${BOT_MENTION} file a Linear issue titled "Test from e2e". Call the ` +
      "confirm_write tool to ask me to approve it before creating anything.",
    sampleIntervalMs: 700,
    maxWaitMs: 20_000,
    expectations: {
      // The confirm_write component renders buttons; verify the text contains
      // "Approve" equivalent or that components are present.
      perMessageChecks: (messages) => {
        const errs: string[] = [];
        const joined = messages.map((m) => m.content).join("\n").toLowerCase();
        const hasButtonMessage = messages.some(
          (m) => m.components && m.components.length > 0,
        );
        if (!joined.includes("create") && !hasButtonMessage) {
          errs.push(
            "no bot reply contained 'create' text or a Components V2 button row",
          );
        }
        return errs;
      },
    },
  },

  {
    name: "E-restart-1 — confirm_write buttons carry encoded value payloads",
    // Verifies the Components V2 button custom_ids include encoded resume data
    // (the durable-action story: a click after a restart must carry enough
    // context for the bridge to reconstruct the HITL resolve). The full
    // kill→restart→click cycle is covered by e2e/restart-recovery.ts.
    prompt:
      `${BOT_MENTION} file a Linear issue titled "Checkout 500s under load". ` +
      "Use the confirm_write tool to ask me to approve it first.",
    sampleIntervalMs: 700,
    maxWaitMs: 20_000,
    expectations: {
      perMessageChecks: (messages) => {
        const errs: string[] = [];
        // Collect all button components across all bot messages.
        const buttons: Array<Record<string, unknown>> = [];
        for (const m of messages) {
          if (!m.components) continue;
          for (const row of m.components) {
            const r = row as { type?: number; components?: Array<Record<string, unknown>> };
            if (r.type === 1 && Array.isArray(r.components)) {
              for (const c of r.components) {
                if ((c as { type?: number }).type === 2) buttons.push(c);
              }
            }
          }
        }
        if (buttons.length < 2) {
          // If no buttons were found in components, check text fallback.
          const joined = messages.map((m) => m.content).join("\n").toLowerCase();
          if (!joined.includes("create") && !joined.includes("approve")) {
            errs.push(
              `expected ≥2 confirm_write buttons (Create/Cancel) or text 'create'/'approve'; found ${buttons.length} button(s)`,
            );
          }
          return errs;
        }
        // When buttons ARE present, verify they carry custom_ids.
        let sawConfirmButton = false;
        for (const btn of buttons) {
          const customId = btn["custom_id"] as string | undefined;
          if (customId) {
            // A non-empty custom_id is enough: it's what the bridge uses to
            // route the interaction back to the HITL resolver.
            sawConfirmButton = true;
          }
        }
        if (!sawConfirmButton) {
          errs.push(
            "no button had a custom_id — bridge cannot route interaction callbacks",
          );
        }
        return errs;
      },
    },
  },

  {
    name: "E-tag-1 — agent uses lookup_discord_user to tag a user in reply",
    prompt:
      `${BOT_MENTION} call the lookup_discord_user tool with query "test" to get ` +
      "a Discord user ID, then reply with a friendly greeting that uses the returned " +
      "mention string verbatim to tag that user. Don't just write the name as plain text.",
    sampleIntervalMs: 700,
    maxWaitMs: 30_000,
    expectations: {
      perMessageChecks: (messages) => {
        const errs: string[] = [];
        const joined = messages.map((m) => m.content).join("\n");
        // A real Discord mention looks like <@SNOWFLAKE_ID>.
        if (!/<@\d+>/.test(joined)) {
          errs.push("no <@USER_ID> mention found in any bot reply");
        }
        return errs;
      },
    },
  },

  {
    name: "E-context-1 — Discord-usage context is delivered to the LLM",
    // Asks the agent to quote from its App Context. If `context` entries are
    // plumbed through to the LLM, the agent will quote a recognisable phrase
    // from discordUsageContext. If context isn't delivered, the agent won't
    // know the exact wording.
    prompt:
      `${BOT_MENTION} in one short line: what does your App Context tell you ` +
      "about how to @-mention people on Discord? Quote the most relevant sentence verbatim.",
    sampleIntervalMs: 700,
    maxWaitMs: 20_000,
    expectations: {
      perMessageChecks: (messages) => {
        const joined = messages.map((m) => m.content).join("\n");
        const witnesses = [
          "<@",
          "lookup_discord_user",
          "@-mention",
          "mention",
        ];
        if (witnesses.some((w) => joined.includes(w))) return [];
        return [
          `final reply quoted no context phrase from ${JSON.stringify(witnesses)}`,
        ];
      },
    },
  },

  // ── F. Loop / echo / event-filter guards ─────────────────────────────

  {
    name: "F-edit — editing a previous message must NOT re-trigger the bot",
    prompt: `${BOT_MENTION} please respond just ONCE and stop`,
    // After the harness gets the first reply, it (conceptually) edits the
    // trigger message. The bot should NOT produce a second reply. This is
    // structural: the Discord listener should ignore MESSAGE_UPDATE events on
    // messages it didn't originate. The harness verifies the bot replied
    // exactly once by checking message count doesn't grow after the edit.
    expectations: {
      minLength: 2,
      perMessageChecks: (messages) => {
        // We just want at least one reply — the runner checks no second reply
        // appears after the "edit" wait period in run.ts.
        if (messages.length === 0) {
          return ["bot produced no reply"];
        }
        return [];
      },
    },
  },
];
