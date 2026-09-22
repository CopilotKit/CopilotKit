import { describe, expect, it, vi } from "vitest";
import { UnverifiedDefinitionError } from "../helpers/conversation-runner.js";
import type { Page } from "../helpers/conversation-runner.js";
import { assertSearchFlights } from "./_beautiful-chat-shared.js";
import { BEAUTIFUL_ROUTE_ACTIONS } from "./_pill-contracts-beautiful-headless.js";
import { buildTurns as bar } from "./d5-beautiful-chat-bar-chart.js";
import { buildTurns as pie } from "./d5-beautiful-chat-pie-chart.js";
import { buildTurns as meeting } from "./d5-beautiful-chat-schedule-meeting.js";
import { buildTurns as flights } from "./d5-beautiful-chat-search-flights.js";
import { buildTurns as theme } from "./d5-beautiful-chat-toggle-theme.js";

function makePage(
  waitForSelector: Page["waitForSelector"] = async () => undefined,
): Page {
  return {
    waitForSelector,
    fill: async () => {
      throw new Error("unexpected typing");
    },
    press: async () => {
      throw new Error("unexpected Enter");
    },
    evaluate: async <R>(fn: () => R): Promise<R> => fn(),
  };
}

const definitions = [
  ["bar-chart", bar],
  ["pie-chart", pie],
  ["schedule-meeting", meeting],
  ["search-flights", flights],
  ["toggle-theme", theme],
] as const;

describe("canonical beautiful-chat actions", () => {
  it.each(definitions)(
    "%s uses the same exact action for every integration",
    (key, build) => {
      for (const integrationSlug of [
        "ag2",
        "agno",
        "built-in-agent",
        "claude-sdk-python",
        "claude-sdk-typescript",
        "crewai-conversational-flows",
        "crewai-crews",
        "google-adk",
        "langgraph-fastapi",
        "langgraph-python",
        "langgraph-typescript",
        "langroid",
        "llamaindex",
        "mastra",
        "ms-agent-dotnet",
        "ms-agent-harness-dotnet",
        "ms-agent-python",
        "pydantic-ai",
        "spring-ai",
        "strands",
        "strands-typescript",
      ]) {
        const turns = build({
          integrationSlug,
          featureType: `beautiful-chat-${key}`,
          baseUrl: "http://localhost:3000",
        });
        expect(turns).toHaveLength(9);
        expect(turns.map((turn) => turn.action)).toEqual(
          BEAUTIFUL_ROUTE_ACTIONS,
        );
        for (const turn of turns) {
          expect(turn.input).toBe(turn.action?.expectedDispatchedPrompt);
          expect(turn.assertions).toBeTypeOf("function");
          expect(turn).toHaveProperty("scenario", "fresh");
          expect(turn.skipSend).toBeUndefined();
          expect(turn.skipFill).toBeUndefined();
        }
      }
    },
  );

  it("retains the theme tool surface completion signal before checking the actual class change", () => {
    const turn = theme({
      integrationSlug: "langgraph-python",
      featureType: "beautiful-chat-toggle-theme",
      baseUrl: "http://localhost:3000",
    }).find((candidate) => candidate.action?.id === "beautiful-toggle-theme");
    expect(turn?.completeOnMount).toEqual({
      testIds: ["copilot-assistant-message"],
    });
  });

  it.each(["beautiful-excalidraw", "beautiful-calculator"])(
    "%s explicitly reports its unverified output definition",
    async (id) => {
      const turn = bar({
        integrationSlug: "langgraph-python",
        featureType: "beautiful-chat-bar-chart",
        baseUrl: "http://localhost:3000",
      }).find((candidate) => candidate.action?.id === id)!;
      await expect(
        turn.assertions!(makePage(), { bubbleIndex: 0, text: "" }),
      ).rejects.toBeInstanceOf(UnverifiedDefinitionError);
      await expect(
        turn.assertions!(makePage(), { bubbleIndex: 0, text: "" }),
      ).rejects.toHaveProperty("errorClass", "unverified-definition");
    },
  );

  it("requires actual FlightCards even when narration exists", async () => {
    const missingCard = vi.fn(async () => {
      throw new Error("card absent");
    });
    const page = makePage(missingCard);
    await expect(assertSearchFlights(page)).rejects.toThrow("card absent");
    expect(missingCard).toHaveBeenCalledOnce();
    expect(missingCard.mock.calls[0]).toBeDefined();
  });
});
