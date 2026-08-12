import { describe, expect, it } from "vitest";
import path from "node:path";
import { globSync } from "glob";
import {
  Journal,
  isTextResponse,
  isToolCallResponse,
  loadFixtureFile,
  matchFixture,
} from "@copilotkit/aimock";
import type {
  ChatCompletionRequest,
  Fixture,
  FixtureResponse,
  ToolCallResponse,
} from "@copilotkit/aimock";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

// ---------------------------------------------------------------------------
// The beautiful-chat calculator pill in every integration's
// _from-feature-parity.json implements a repeat-click design:
//
//   click 1 → sequenceIndex 0 variant → calculator_001 tool call
//   click 2 → sequenceIndex 1 variant → calculator_002 tool call
//   click 3+ → non-sequenced fallback → calculator_003 tool call (repeats)
//
// with a dedicated toolCallId follow-up entry per leg so the second LLM
// round-trip (thread ends with the tool result) returns text instead of
// another tool call. Because aimock's matchFixture is FIRST-match over the
// fixture array, correctness depends on four ordering invariants:
//
//   (1) the three toolCallId follow-up entries precede the leg-1 variants —
//       otherwise the follow-up request (whose last USER message is still the
//       pill text) re-matches a leg-1 variant and the demo tool-call-loops;
//   (2) the sequenceIndex 0/1 variants precede the non-sequenced _003
//       fallback — otherwise every click pins to _003 permanently;
//   (3) the fallback precedes the generic "build a modern calculator" pair —
//       the generic pill is a SUBSTRING of the calculator pill, so reversed
//       order would hijack the calculator pill into the open-gen-ui demo;
//   (4) within the generic pair, the toolCallId follow-up entry precedes the
//       generic leg-1 entry — same loop-prevention rationale as (1).
//
// These invariants were previously enforced only by comments inside the
// fixture files. This test pins them structurally AND behaviorally for every
// integration.
// ---------------------------------------------------------------------------

const CALC_PILL = "build a modern calculator with standard buttons";
const GENERIC_PILL = "build a modern calculator";
// The FULL production pill text, from
// src/app/demos/beautiful-chat/hooks/use-example-suggestions.tsx in 17 of the
// 19 integrations — built-in-agent and claude-sdk-python have no calculator
// pill; their fixture blocks are mirror-parity entries per the GOTCHAS MIRROR
// rule, ready for when those demos gain the pill. The fixture matchers above
// (CALC_PILL / GENERIC_PILL) are SUBSTRINGS of this — the behavioral walk
// sends the full text so it exercises the same substring matching the live
// demo relies on.
const CALC_PILL_FULL =
  "Using the generateSandboxedUi tool, build a modern calculator with " +
  "standard buttons plus labeled metric shortcut buttons that insert their " +
  "values into the display when clicked. Use sample company data.";
const CALC_CALL_IDS = [
  "call_fp_beautiful_chat_calculator_001",
  "call_fp_beautiful_chat_calculator_002",
  "call_fp_beautiful_chat_calculator_003",
] as const;
const GENERIC_CALL_ID = "call_fp_open_gen_ui_calc_001";

const fixtureFiles = globSync(
  "showcase/aimock/d6/*/_from-feature-parity.json",
  { cwd: REPO_ROOT, absolute: true },
).sort();

const integrations = fixtureFiles.map((file) => ({
  slug: path.basename(path.dirname(file)),
  file,
}));

interface CalcEntryIndices {
  followUps: number[]; // toolCallId calculator_001/002/003 follow-up entries
  sequenced: number[]; // CALC_PILL + sequenceIndex 0/1 leg-1 variants
  fallback: number[]; // CALC_PILL without sequenceIndex (_003 fallback)
  genericFollowUps: number[]; // toolCallId open_gen_ui_calc_001 follow-up
  genericLeg1: number[]; // generic GENERIC_PILL leg-1 entry
}

function indexCalcEntries(fixtures: Fixture[]): CalcEntryIndices {
  const out: CalcEntryIndices = {
    followUps: [],
    sequenced: [],
    fallback: [],
    genericFollowUps: [],
    genericLeg1: [],
  };
  fixtures.forEach((f, i) => {
    const m = f.match;
    if (
      m.toolCallId !== undefined &&
      (CALC_CALL_IDS as readonly string[]).includes(m.toolCallId)
    ) {
      out.followUps.push(i);
    } else if (m.userMessage === CALC_PILL) {
      if (m.sequenceIndex !== undefined) out.sequenced.push(i);
      else out.fallback.push(i);
    } else if (m.toolCallId === GENERIC_CALL_ID) {
      out.genericFollowUps.push(i);
    } else if (m.userMessage === GENERIC_PILL) {
      out.genericLeg1.push(i);
    }
  });
  return out;
}

/**
 * Fail-loud guard: loadFixtureFile swallows read/parse/shape errors and
 * returns [] (it only warns). Without this guard a broken fixture file would
 * make the ordering test pass vacuously — Math.max(...[]) === -Infinity is
 * less than Math.min(...[]) === Infinity, so every ordering assertion would
 * hold over empty index arrays.
 */
function expectNonEmptyFixtures(fixtures: Fixture[], rel: string): void {
  expect(
    fixtures.length,
    `${rel}: loadFixtureFile returned an empty array — it swallows parse/load ` +
      `errors and returns [], so this usually means the file is unreadable or ` +
      `contains invalid JSON, not that it has no fixtures`,
  ).toBeGreaterThan(0);
}

/**
 * Mirror of the server request flow (see aimock's handler implementations):
 * matchFixture reads the journal's per-testId match counts, and a successful
 * match increments them (which is what makes sequenceIndex advance).
 *
 * Note: this mirror assumes no requestTransform is configured — passing one to
 * matchFixture flips matching into exact mode and would desynchronize this
 * mirror from the (substring-matching) server behavior tested here.
 */
function send(
  fixtures: Fixture[],
  journal: Journal,
  testId: string,
  slug: string,
  messages: ChatCompletionRequest["messages"],
): Fixture | null {
  const req = {
    model: "gpt-5.4",
    messages: [...messages],
    // D6 fixtures use match.context for per-integration scoping; aimock's
    // matchFixture checks req._context against it.
    _context: slug,
    // Mirrors server.js:343 — pinned so this mirror cannot silently desync
    // if a future aimock version branches on the endpoint type.
    _endpointType: "chat",
  } as ChatCompletionRequest;
  const fixture = matchFixture(
    fixtures,
    req,
    journal.getFixtureMatchCountsForTest(testId),
  );
  if (fixture) journal.incrementFixtureMatchCount(fixture, fixtures, testId);
  return fixture;
}

describe("beautiful-chat calculator fixture routing", () => {
  it("discovers all 20 integration _from-feature-parity.json files", () => {
    expect(
      integrations.map((i) => i.slug),
      "integration count changed — new integration added? mirror its " +
        "calculator fixtures from langgraph-python and update this pin",
    ).toHaveLength(20);
  });

  for (const { slug, file } of integrations) {
    describe(slug, () => {
      const fixtures = loadFixtureFile(file);
      const rel = path.relative(REPO_ROOT, file);

      it("declares the full calculator entry set", () => {
        expectNonEmptyFixtures(fixtures, rel);
        const idx = indexCalcEntries(fixtures);
        expect(idx.followUps, `${rel}: calculator follow-ups`).toHaveLength(3);
        expect(idx.sequenced, `${rel}: sequenced leg-1 variants`).toHaveLength(
          2,
        );
        expect(
          idx.fallback,
          `${rel}: non-sequenced _003 fallback`,
        ).toHaveLength(1);
        expect(
          idx.genericFollowUps,
          `${rel}: generic follow-up entry`,
        ).toHaveLength(1);
        expect(idx.genericLeg1, `${rel}: generic leg-1 entry`).toHaveLength(1);
      });

      it("orders entries: follow-ups → sequenced variants → fallback → generic pair", () => {
        expectNonEmptyFixtures(fixtures, rel);
        const idx = indexCalcEntries(fixtures);

        // Guard every index bucket so the Math.max/Math.min comparisons below
        // can never pass vacuously over empty arrays (-Infinity < Infinity).
        for (const [bucket, indices] of Object.entries(idx)) {
          expect(
            indices.length,
            `${rel}: no ${bucket} entries indexed — the ordering assertions ` +
              `below would be vacuous over an empty bucket`,
          ).toBeGreaterThan(0);
        }

        const leg1 = [...idx.sequenced, ...idx.fallback];
        const generic = [...idx.genericFollowUps, ...idx.genericLeg1];

        // (1) toolCallId follow-ups precede ALL leg-1 variants.
        expect(
          Math.max(...idx.followUps),
          `${rel}: a calculator toolCallId follow-up entry must precede every ` +
            `leg-1 variant, or follow-up requests re-match a leg-1 fixture ` +
            `and the demo tool-call-loops`,
        ).toBeLessThan(Math.min(...leg1));

        // (2) sequenceIndex variants precede the non-sequenced fallback.
        expect(
          Math.max(...idx.sequenced),
          `${rel}: sequenceIndex 0/1 variants must precede the non-sequenced ` +
            `_003 fallback, or every click pins to _003 permanently`,
        ).toBeLessThan(idx.fallback[0]);

        // (3) the fallback precedes the generic "build a modern calculator"
        // pair (whose pill is a substring of the calculator pill).
        expect(
          idx.fallback[0],
          `${rel}: the _003 fallback must precede the generic ` +
            `"${GENERIC_PILL}" pair, or substring matching hijacks the ` +
            `calculator pill into the open-gen-ui fixtures`,
        ).toBeLessThan(Math.min(...generic));

        // (4) within the generic pair, the toolCallId follow-up precedes the
        // generic leg-1 entry — same loop-prevention rationale as (1): a
        // reversed order would re-match leg-1 on the follow-up round-trip.
        expect(
          Math.max(...idx.genericFollowUps),
          `${rel}: the generic toolCallId follow-up (${GENERIC_CALL_ID}) must ` +
            `precede the generic "${GENERIC_PILL}" leg-1 entry, or the ` +
            `follow-up request re-matches leg-1 and the demo tool-call-loops`,
        ).toBeLessThan(Math.min(...idx.genericLeg1));
      });

      it("routes four repeat clicks through _001 → _002 → _003 → _003 with follow-ups", () => {
        expectNonEmptyFixtures(fixtures, rel);
        const journal = new Journal();
        const testId = `calc-routing-${slug}`;
        const messages: ChatCompletionRequest["messages"] = [];

        const clickLeg1 = (click: number, expectedCallId: string) => {
          // Send the FULL production pill text — the fixture matchers are
          // substrings of it (see CALC_PILL_FULL above).
          messages.push({ role: "user", content: CALC_PILL_FULL });
          const fixture = send(fixtures, journal, testId, slug, messages);
          expect(
            fixture,
            `${rel}: click-${click} leg-1 strict-missed`,
          ).not.toBeNull();
          const response = fixture!.response as FixtureResponse;
          expect(
            isToolCallResponse(response),
            `${rel}: click-${click} leg-1 must return a tool call`,
          ).toBe(true);
          const toolCall = (response as ToolCallResponse).toolCalls[0];
          expect(
            toolCall.id,
            `${rel}: click-${click} leg-1 routed to the wrong fixture`,
          ).toBe(expectedCallId);
          // Append the assistant tool call + tool result, as the host does.
          messages.push({
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: expectedCallId,
                type: "function",
                function: {
                  name: toolCall.name,
                  arguments: toolCall.arguments,
                },
              },
            ],
          });
          messages.push({
            role: "tool",
            content: "rendered",
            tool_call_id: expectedCallId,
          });
        };

        const followUp = (click: number, expectedCallId: string) => {
          // Thread's last message is now the tool result for expectedCallId.
          const fixture = send(fixtures, journal, testId, slug, messages);
          expect(
            fixture,
            `${rel}: click-${click} follow-up strict-missed`,
          ).not.toBeNull();
          expect(
            fixture!.match.toolCallId,
            `${rel}: click-${click} follow-up matched a non-follow-up fixture ` +
              `(tool-call loop)`,
          ).toBe(expectedCallId);
          const response = fixture!.response as FixtureResponse;
          expect(
            isTextResponse(response),
            `${rel}: click-${click} follow-up must return text`,
          ).toBe(true);
          messages.push({
            role: "assistant",
            content: (response as { content: string }).content,
          });
        };

        clickLeg1(1, CALC_CALL_IDS[0]);
        followUp(1, CALC_CALL_IDS[0]);
        clickLeg1(2, CALC_CALL_IDS[1]);
        followUp(2, CALC_CALL_IDS[1]);
        clickLeg1(3, CALC_CALL_IDS[2]);
        followUp(3, CALC_CALL_IDS[2]);
        // Click 4+: the non-sequenced fallback keeps serving _003 — no
        // strict-miss, no pinning regression — and its toolCallId follow-up
        // keeps serving too (the _003 follow-up must match repeatedly).
        clickLeg1(4, CALC_CALL_IDS[2]);
        followUp(4, CALC_CALL_IDS[2]);
      });
    });
  }
});
