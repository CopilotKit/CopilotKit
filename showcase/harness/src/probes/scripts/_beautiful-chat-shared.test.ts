import { describe, expect, it, vi } from "vitest";
import type { Page } from "../helpers/conversation-runner.js";
import { assertSearchFlights } from "./_beautiful-chat-shared.js";

function makePage(
  waitForSelector = vi.fn(
    async (
      _selector: string,
      _opts?: { state?: "visible"; timeout?: number },
    ) => undefined,
  ),
): Page {
  return {
    waitForSelector,
    fill: async () => undefined,
    press: async () => undefined,
    evaluate: async <R>(fn: () => R): Promise<R> => fn(),
  };
}

describe("assertSearchFlights", () => {
  it("accepts the turn-scoped narration without querying global DOM text", async () => {
    const waitForSelector = vi.fn(
      async (
        _selector: string,
        _opts?: { state?: "visible"; timeout?: number },
      ) => undefined,
    );
    const page = makePage(waitForSelector);

    await assertSearchFlights(page, {
      bubbleIndex: 0,
      text: "United at $349 and Delta at $289 are available.",
    });

    expect(waitForSelector).not.toHaveBeenCalled();
  });

  it("falls back to the rendered surface when narration lacks the literals", async () => {
    const waitForSelector = vi.fn(
      async (
        _selector: string,
        _opts?: { state?: "visible"; timeout?: number },
      ) => undefined,
    );
    const page = makePage(waitForSelector);

    await assertSearchFlights(page, {
      bubbleIndex: 0,
      text: "I rendered the flight options above.",
    });

    expect(waitForSelector.mock.calls.map(([selector]) => selector)).toEqual([
      "text=United",
      "text=Delta",
      "text=$349",
      "text=$289",
    ]);
  });
});
