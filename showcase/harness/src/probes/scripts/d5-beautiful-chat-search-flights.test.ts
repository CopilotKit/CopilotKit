import { describe, expect, it, vi } from "vitest";

import type { D5BuildContext } from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";
import { waitForText } from "./_beautiful-chat-shared.js";
import { buildTurns } from "./d5-beautiful-chat-search-flights.js";

const CONTEXT: D5BuildContext = {
  integrationSlug: "langgraph-python",
  featureType: "beautiful-chat-search-flights",
  baseUrl: "https://showcase.example.test",
};

function makeBodyTextPage(bodyTexts: readonly string[]): {
  page: Page;
  waitForSelector: ReturnType<typeof vi.fn>;
} {
  let readIndex = 0;
  const waitForSelector = vi.fn(async () => {
    throw new Error("selector engine did not find the rendered text");
  });
  const page: Page = {
    waitForSelector,
    async fill() {},
    async press() {},
    async evaluate<R>(): Promise<R> {
      const value = bodyTexts[Math.min(readIndex, bodyTexts.length - 1)] ?? "";
      readIndex += 1;
      return value as R;
    },
  };
  return { page, waitForSelector };
}

describe("beautiful-chat Search Flights probe", () => {
  it("sends the product suggestion verbatim so aimock selects the scoped fixture", () => {
    expect(buildTurns(CONTEXT)[0]?.input).toBe(
      "Find flights from SFO to JFK for next Tuesday.",
    );
  });

  it("recognizes literal text already present in the visible page body", async () => {
    const { page, waitForSelector } = makeBodyTextPage([
      "United Airlines UA123 $349 Delta Air Lines DL456 $289",
    ]);

    await expect(
      waitForText(page, "United", 20, "beautiful-chat-search-flights"),
    ).resolves.toBeUndefined();
    expect(waitForSelector).not.toHaveBeenCalled();
  });

  it("polls visible body text until a delayed A2UI card appears", async () => {
    const { page } = makeBodyTextPage([
      "Searching for flights…",
      "United Airlines UA123 $349",
    ]);

    await expect(
      waitForText(page, "United", 250, "beautiful-chat-search-flights"),
    ).resolves.toBeUndefined();
  });

  it("preserves a descriptive timeout when visible text never appears", async () => {
    const { page } = makeBodyTextPage(["No matching flights yet"]);

    await expect(
      waitForText(page, "United", 1, "beautiful-chat-search-flights"),
    ).rejects.toThrow(
      'beautiful-chat-search-flights: expected text "United" to appear within 1ms',
    );
  });
});
