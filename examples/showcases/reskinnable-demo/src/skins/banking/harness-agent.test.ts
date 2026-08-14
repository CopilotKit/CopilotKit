import { describe, expect, it } from "vitest";
import { shouldRouteToHarness } from "./harness-agent";
import { EXPENSE_PILL_MESSAGE } from "./suggestions";

/**
 * ARM C's router. The whole arm hinges on this predicate: route wrongly and
 * either an ordinary "what's on my screen?" spawns a codex sandbox, or the
 * expense job is answered conversationally with no harness at all — and both
 * failures look like a working demo until someone reads the transcript.
 *
 * The input type is STRUCTURAL rather than `RunAgentInput`: that type is not
 * re-exported from `@copilotkit/runtime/v2` (checked against
 * `dist/v2/index.d.mts`), and importing it from `@ag-ui/core` would add a
 * direct dependency on a package this app only has transitively — one currently
 * pinned to a canary. A structural type also lets these cases be written as
 * plain literals with no cast.
 */

/**
 * Fixtures go through these two helpers rather than being written inline at the
 * call site: an object literal passed straight to `shouldRouteToHarness` is
 * excess-property-checked against the structural type, which would force the
 * fixtures to drop `id` and stop looking like the real thing.
 */
const runInput = (
  messages: readonly { id: string; role: string; content: unknown }[],
) => ({ messages });

const inputWith = (content: string) =>
  runInput([{ id: "1", role: "user", content }]);

describe("shouldRouteToHarness", () => {
  it("routes the pill message to the harness", () => {
    expect(shouldRouteToHarness(inputWith(EXPENSE_PILL_MESSAGE))).toBe(true);
  });

  it("does not route an ordinary question", () => {
    expect(shouldRouteToHarness(inputWith("what's on my screen?"))).toBe(false);
  });

  it("routes on the LAST user message, not an earlier one", () => {
    // The pill's run is over; this is the follow-up turn. Matching anywhere in
    // history would re-launch a four-minute harness on every later message.
    expect(
      shouldRouteToHarness(
        runInput([
          { id: "1", role: "user", content: EXPENSE_PILL_MESSAGE },
          { id: "2", role: "assistant", content: "done" },
          { id: "3", role: "user", content: "thanks, now show my cards" },
        ]),
      ),
    ).toBe(false);
  });

  it("routes when the harness turn is the last USER message", () => {
    // …and the mirror case: an assistant message after the pill must not stop
    // the run being routed, which is what a naive "last message" check breaks on.
    expect(
      shouldRouteToHarness(
        runInput([
          { id: "1", role: "user", content: "show my cards" },
          { id: "2", role: "assistant", content: "here they are" },
          { id: "3", role: "user", content: EXPENSE_PILL_MESSAGE },
        ]),
      ),
    ).toBe(true);
  });

  it("tolerates surrounding whitespace on the pill message", () => {
    expect(shouldRouteToHarness(inputWith(`  ${EXPENSE_PILL_MESSAGE}\n`))).toBe(
      true,
    );
  });

  it("does not route a message that merely CONTAINS the pill text", () => {
    // Exact match, not `includes`: a user quoting the pill while asking
    // something else must not spawn a sandbox.
    expect(
      shouldRouteToHarness(
        inputWith(`Why did "${EXPENSE_PILL_MESSAGE}" fail last time?`),
      ),
    ).toBe(false);
  });

  it("routes a MULTIMODAL turn whose text part is the pill message", () => {
    // This is the shape the pill actually sends: it stages the statement CSV
    // into the composer (`attach-statement.ts`), so the turn arrives as parts
    // rather than a string. A string-only router would stop matching the day
    // that attachment was added and answer the expense job conversationally,
    // with no harness and no error.
    expect(
      shouldRouteToHarness(
        runInput([
          {
            id: "1",
            role: "user",
            content: [
              { type: "text", text: EXPENSE_PILL_MESSAGE },
              {
                type: "document",
                mimeType: "text/csv",
                name: "personal-card-statement-july-2026.csv",
              },
            ],
          },
        ]),
      ),
    ).toBe(true);
  });

  it("ignores non-text parts when reading a multimodal turn", () => {
    // The document part must not be concatenated into the compared text, or the
    // exact match silently becomes "starts with".
    expect(
      shouldRouteToHarness(
        runInput([
          {
            id: "1",
            role: "user",
            content: [
              { type: "text", text: EXPENSE_PILL_MESSAGE },
              { type: "text", text: " and also cancel my card" },
            ],
          },
        ]),
      ),
    ).toBe(false);
  });

  it("does not route content that carries no text at all", () => {
    // An attachment-only turn. Reading `.trim()` off the array would throw
    // inside the factory, i.e. on the run itself.
    expect(
      shouldRouteToHarness(
        runInput([
          {
            id: "1",
            role: "user",
            content: [{ type: "document", mimeType: "text/csv" }],
          },
        ]),
      ),
    ).toBe(false);
  });

  it("does not route when there is no user message at all", () => {
    expect(shouldRouteToHarness(runInput([]))).toBe(false);
  });
});
