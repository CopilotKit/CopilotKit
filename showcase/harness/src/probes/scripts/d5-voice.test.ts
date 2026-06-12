import { describe, it, expect } from "vitest";
import { getD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";
// Top-level import triggers the script's `registerD5Script` side effect
// against the singleton registry. Mirrors the pattern in
// `d5-tool-rendering.test.ts` — the registry is process-wide, modules
// are cached, so we register once at import time and read it back via
// `getD5Script` per assertion.
import { buildTurns, SAMPLE_AUDIO_BUTTON_SELECTOR } from "./d5-voice.js";

/**
 * Tests for the D5 voice script. Three concerns:
 *
 *   1. Side-effect registration — the import wires up `voice` in the
 *      registry pointing at the bundled `d5-all.json` fixture (the
 *      script reuses the canned transcription + weather fixtures that
 *      already live there).
 *   2. `buildTurns` produces a single `skipFill` turn whose `preFill`
 *      drives the sample-audio button click + textarea-poll path.
 *   3. The `assertions` callback fires (throws) when the assistant
 *      transcript is empty/missing the weather/Tokyo content, and
 *      passes through when the transcript contains the expected
 *      keywords.
 */

interface FakePageScript {
  /** Sequence of textContent values returned by readAssistantTranscript. */
  evaluateValues?: unknown[];
  /** Whether `waitForSelector` should throw (button not visible). */
  throwOnWaitForSelector?: boolean;
  /** Whether the click should throw. */
  throwOnClick?: boolean;
  /** Sequence of textarea values returned to the textarea poll. */
  textareaValues?: string[];
  /** Tracks how many times the click was invoked. */
  clickCalls?: { count: number };
}

/**
 * Build a fake Page that satisfies the runner's `Page` interface plus the
 * additional `click` method d5-voice's preFill uses. The fake interleaves
 * two `evaluate` consumers: the textarea-value poll inside preFill, and
 * the assistant-transcript read inside the assertion. We split them by
 * tagging `evaluateValues` (used after preFill returns) and
 * `textareaValues` (consumed by the textarea poll). The fake hands out
 * textareaValues first, then falls through to evaluateValues.
 */
function makePage(script: FakePageScript = {}): Page & {
  click: (sel: string, opts?: { timeout?: number }) => Promise<void>;
} {
  const transcripts = [...(script.evaluateValues ?? [])];
  const textareaQueue = [...(script.textareaValues ?? [])];
  return {
    async waitForSelector() {
      if (script.throwOnWaitForSelector) {
        throw new Error("waitForSelector timeout (test fake)");
      }
    },
    async fill() {
      // Unused — voice script uses skipFill: true.
    },
    async press() {
      // Unused — these tests assert on preFill + assertion, not the
      // runner's press step.
    },
    async click() {
      if (script.clickCalls) script.clickCalls.count += 1;
      if (script.throwOnClick) {
        throw new Error("click failed (test fake)");
      }
    },
    async evaluate<R>(): Promise<R> {
      // The textarea-value poll runs first (during preFill); after it
      // resolves, evaluateValues feeds the assistant-transcript reader.
      if (textareaQueue.length > 0) {
        const next = textareaQueue.shift();
        // The textarea poll evaluator returns a string. Wrap as the
        // generic R the caller asked for — the runner doesn't introspect.
        return next as unknown as R;
      }
      if (transcripts.length === 0) return undefined as R;
      if (transcripts.length === 1) return transcripts[0] as R;
      return transcripts.shift() as R;
    },
  };
}

describe("d5-voice script", () => {
  describe("registration", () => {
    it("registers under featureType 'voice' with the bundled d5-all.json fixture", () => {
      const script = getD5Script("voice");
      expect(script).toBeDefined();
      expect(script?.featureTypes).toEqual(["voice"]);
      // Voice piggybacks on the bundled d5-all.json fixture because the
      // canned transcription + weather get_weather entries already live
      // there. No per-feature fixture file is needed.
      expect(script?.fixtureFile).toBe("d5-all.json");
    });

    it("registers a buildTurns function that round-trips through the registry", () => {
      const script = getD5Script("voice");
      expect(script?.buildTurns).toBe(buildTurns);
    });
  });

  describe("buildTurns", () => {
    const ctx: D5BuildContext = {
      integrationSlug: "langgraph-python",
      featureType: "voice",
      baseUrl: "https://example.test",
    };

    it("produces a single turn with skipFill=true and an empty input", () => {
      const turns = buildTurns(ctx);
      expect(turns).toHaveLength(1);
      const turn = turns[0]!;
      expect(turn.skipFill).toBe(true);
      // input is empty because preFill + the synchronous text injection
      // populate the textarea — `page.fill()` would overwrite it.
      expect(turn.input).toBe("");
      expect(typeof turn.preFill).toBe("function");
      expect(typeof turn.assertions).toBe("function");
    });

    it("uses the canonical sample-audio-button testid", () => {
      // Pinning the selector here so a refactor that breaks the testid
      // surfaces as a test failure rather than a silent probe miss.
      expect(SAMPLE_AUDIO_BUTTON_SELECTOR).toBe(
        '[data-testid="voice-sample-audio-button"]',
      );
    });
  });

  describe("preFill", () => {
    it("clicks the sample audio button and resolves once the textarea is populated", async () => {
      const turns = buildTurns({
        integrationSlug: "langgraph-python",
        featureType: "voice",
        baseUrl: "https://example.test",
      });
      const turn = turns[0]!;
      const clickCalls = { count: 0 };
      const page = makePage({
        clickCalls,
        // First poll returns "" (still empty), second returns the canned
        // phrase — the script must keep polling until non-empty rather
        // than returning on first read.
        textareaValues: ["", "What is the weather in Tokyo?"],
      });

      await turn.preFill!(page);

      expect(clickCalls.count).toBe(1);
    });

    it("throws when the sample-audio button never becomes visible", async () => {
      const turns = buildTurns({
        integrationSlug: "langgraph-python",
        featureType: "voice",
        baseUrl: "https://example.test",
      });
      const turn = turns[0]!;
      const page = makePage({ throwOnWaitForSelector: true });

      await expect(turn.preFill!(page)).rejects.toThrow(
        /sample audio button.*not visible/,
      );
    });
  });

  describe("assertion", () => {
    it("passes when the assistant transcript mentions weather", async () => {
      const turns = buildTurns({
        integrationSlug: "langgraph-python",
        featureType: "voice",
        baseUrl: "https://example.test",
      });
      const turn = turns[0]!;
      const page = makePage({
        evaluateValues: ["the weather in tokyo is 22°c and partly cloudy"],
      });

      await expect(turn.assertions!(page)).resolves.toBeUndefined();
    });

    it("passes on temperature-only mention (matches the weather/tokyo/temperature OR cascade)", async () => {
      const turns = buildTurns({
        integrationSlug: "langgraph-python",
        featureType: "voice",
        baseUrl: "https://example.test",
      });
      const turn = turns[0]!;
      const page = makePage({
        evaluateValues: ["current temperature: 22 degrees"],
      });

      await expect(turn.assertions!(page)).resolves.toBeUndefined();
    });

    it("throws when the assistant transcript is unrelated to weather", async () => {
      const turns = buildTurns({
        integrationSlug: "langgraph-python",
        featureType: "voice",
        baseUrl: "https://example.test",
      });
      const turn = turns[0]!;
      const page = makePage({
        evaluateValues: ["i don't know how to answer that question"],
      });

      // The assertion polls for up to 5s before giving up — give the
      // test enough headroom to observe the rejection rather than
      // racing it against vitest's default 5000ms timeout.
      await expect(turn.assertions!(page)).rejects.toThrow(
        /assistant transcript missing weather\/Tokyo content/,
      );
    }, 10_000);
  });
});
