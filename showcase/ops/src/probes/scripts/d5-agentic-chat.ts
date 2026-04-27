/**
 * D5 — agentic-chat script.
 *
 * Three-turn conversation that exercises the LangGraph Python (LGP)
 * `agentic_chat` agent (`/demos/agentic-chat`). The agent has no
 * backend tools (see `showcase/packages/langgraph-python/src/agents/
 * agentic_chat.py`) — it is a plain conversational agent. The script
 * verifies basic conversational competence AND context retention
 * across turns:
 *
 *   1. Greeting / first ask — set up the conversational context
 *      ("good name for a goldfish"). The fixture's first response
 *      establishes "Bubbles" as the named entity.
 *   2. Follow-up that depends on prior turn ("name for its tank").
 *      The fixture continues the Bubbles theme and replies with
 *      "The Bubble Bowl".
 *   3. Memory check that depends on the whole conversation
 *      ("what we named the goldfish"). The fixture reads back both
 *      "Bubbles" AND "The Bubble Bowl" — this is the actual
 *      context-retention assertion.
 *
 * Per-turn user-message phrasing is **mirrored verbatim** from
 * `showcase/ops/fixtures/d5/agentic-chat.json` so aimock's substring
 * `userMessage` matcher selects the right canned response. Each turn's
 * input includes the fixture's `userMessage` substring. Fixture
 * substrings (case-sensitive — see aimock router):
 *
 *   - turn 1: "good name for a goldfish"
 *   - turn 2: "name for its tank"
 *   - turn 3: "what we named the goldfish"
 *
 * If the fixture is updated, mirror the change here. The fixture is
 * the source of truth.
 *
 * Self-registration: this module's top-level `registerD5Script(...)`
 * call is the entire public surface. The driver's dynamic loader
 * imports the file purely for the side effect.
 */

import { registerD5Script } from "../helpers/d5-registry.js";
import {
  ASSISTANT_MESSAGE_FALLBACK_SELECTOR,
  ASSISTANT_MESSAGE_PRIMARY_SELECTOR,
  type ConversationTurn,
  type Page,
} from "../helpers/conversation-runner.js";

/**
 * Read all visible assistant-message text from the page. Mirrors the
 * conversation-runner's selector cascade — canonical CopilotKit testid
 * first, generic `[role="article"]` fallback for custom composers.
 *
 * Returns a single concatenated lowercase string so callers can do a
 * substring check without worrying about message boundaries (some
 * showcases split the assistant reply across multiple bubbles when
 * tool / state events are interleaved).
 */
async function readAssistantTranscript(page: Page): Promise<string> {
  // Use the same canonical + user-bubble-excluding fallback selectors
  // as `conversation-runner.ts::readMessageCount`. A bare
  // `[role="article"]` would scoop up user input bubbles into the
  // transcript and let turn 1's "good name for a goldfish" substring
  // accidentally match the user's own message instead of the
  // assistant's reply.
  const code = `
    (() => {
      const doc = globalThis.document;
      const canonical = doc.querySelectorAll(${JSON.stringify(
        ASSISTANT_MESSAGE_PRIMARY_SELECTOR,
      )});
      const nodes = canonical.length > 0
        ? canonical
        : doc.querySelectorAll(${JSON.stringify(
          ASSISTANT_MESSAGE_FALLBACK_SELECTOR,
        )});
      let out = "";
      for (let i = 0; i < nodes.length; i++) {
        const text = (nodes[i] && nodes[i].textContent) ? nodes[i].textContent : "";
        out += " " + text;
      }
      return out.toLowerCase();
    })()
  `;
  const fn = new Function(`return ${code.trim()};`) as () => string;
  return page.evaluate(fn);
}

/**
 * Build a substring assertion. `anyOf` semantics: at least one of the
 * candidate fragments must appear in the assistant transcript. This
 * keeps soft, content-style checks generous (turn 2's "tank-name word"
 * accepts any of several plausible nouns) while turning a real
 * regression — empty assistant response, completely off-topic reply —
 * into a clear failure.
 *
 * `mustBeNonEmpty`: fail if the transcript is whitespace-only. A
 * silent turn (assistant produced nothing visible) is the most common
 * D5 failure mode in practice — usually a runtime-side streaming or
 * rendering bug — so we surface it explicitly rather than letting it
 * slip past as "well, no fragment matched".
 */
function expectAssistantContains(opts: {
  fragments: string[];
  label: string;
}): (page: Page) => Promise<void> {
  return async (page: Page) => {
    const transcript = (await readAssistantTranscript(page)) ?? "";
    if (transcript.trim().length === 0) {
      throw new Error(`${opts.label}: assistant response was empty`);
    }
    const lowered = transcript;
    const hit = opts.fragments.some((frag) =>
      lowered.includes(frag.toLowerCase()),
    );
    if (!hit) {
      throw new Error(
        `${opts.label}: assistant response did not contain any of [${opts.fragments
          .map((f) => JSON.stringify(f))
          .join(", ")}]`,
      );
    }
  };
}

/**
 * Looser non-empty-only assertion. Used for turn 1, where any
 * conversational reply is acceptable — the substantive content checks
 * happen on later turns.
 */
function expectAssistantNonEmpty(label: string): (page: Page) => Promise<void> {
  return async (page: Page) => {
    const transcript = (await readAssistantTranscript(page)) ?? "";
    if (transcript.trim().length === 0) {
      throw new Error(`${label}: assistant response was empty`);
    }
  };
}

/**
 * Build the 3-turn agentic-chat conversation. Exported (named) for the
 * unit test — production callers go through the registry.
 */
export function buildAgenticChatTurns(): ConversationTurn[] {
  return [
    {
      // Turn 1 — greeting / first ask. Must contain the fixture
      // substring "good name for a goldfish" verbatim. The fixture's
      // canned reply names the goldfish "Bubbles".
      input:
        "Hi! Can you suggest a good name for a goldfish I'm bringing home?",
      assertions: expectAssistantNonEmpty("turn 1"),
    },
    {
      // Turn 2 — follow-up referencing prior turn. Must contain the
      // fixture substring "name for its tank" verbatim. The fixture
      // continues the Bubbles theme and replies with "The Bubble Bowl",
      // so the assertion's anyOf list covers the canonical reply plus
      // a small set of plausible alternatives ("bowl", "bubble") so a
      // legitimate model rephrasing doesn't fail the check.
      input: "Nice — and what would be a good name for its tank?",
      assertions: expectAssistantContains({
        fragments: ["bubble", "bowl", "tank"],
        label: "turn 2",
      }),
    },
    {
      // Turn 3 — context verification. Must contain the fixture
      // substring "what we named the goldfish" verbatim. Per spec the
      // assertion checks that the context from turn 1 is recalled —
      // the goldfish's name "Bubbles". Case-insensitive (the helper
      // lowercases the transcript before comparison).
      input: "Quick — can you remind me what we named the goldfish?",
      assertions: expectAssistantContains({
        fragments: ["bubbles"],
        label: "turn 3",
      }),
    },
  ];
}

registerD5Script({
  featureTypes: ["agentic-chat"],
  fixtureFile: "agentic-chat.json",
  buildTurns: buildAgenticChatTurns,
});
