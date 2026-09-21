import { UnverifiedDefinitionError } from "../helpers/conversation-runner.js";
import { describe, expect, it, vi } from "vitest";
import type { Page } from "../helpers/conversation-runner.js";
import {
  buildToolsAgentTurns,
  TOOLS_AGENT_PILLS,
} from "./_pill-contracts-tools-agents.js";

const empty = () => ({
  weather: [],
  flights: [],
  stock: [],
  dice: [],
  custom: [],
  default: [],
  chain: [],
  reasoning: [],
  researcher: [],
  writer: [],
  critic: [],
  iframe: [],
});
function card(text: string, fields: Record<string, string[]>, visible = true) {
  return { text, fields, visible, status: "complete", tool: null, pre: [] };
}
function pageFor(
  feature: keyof typeof TOOLS_AGENT_PILLS,
  result: unknown,
): Page {
  return {
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockRejectedValue(new Error("typing forbidden")),
    press: vi.fn().mockRejectedValue(new Error("typing forbidden")),
    evaluate: vi
      .fn()
      .mockResolvedValueOnce(
        TOOLS_AGENT_PILLS[feature].map((p) => p.buttonName),
      )
      .mockResolvedValueOnce(empty())
      .mockResolvedValueOnce(result),
  };
}

describe("canonical tools/agents result guards", () => {
  it.each([
    ["wrong city", "Tokyo", "55%", "10 mph", true],
    ["wrong humidity", "San Francisco", "10%", "55 mph", true],
    ["hidden result", "San Francisco", "55%", "10 mph", false],
  ] as const)(
    "rejects %s despite a mounted weather card",
    async (_name, city, humidity, wind, visible) => {
      const page = pageFor("tool-rendering", {
        ...empty(),
        weather: [
          card(
            "68°F\nSunny",
            {
              "weather-city": [city],
              "weather-humidity": [humidity],
              "weather-wind": [wind],
            },
            visible,
          ),
        ],
      });
      const turn = buildToolsAgentTurns("tool-rendering")[0]!;
      await turn.preFill!(page);
      await expect(
        turn.assertions!(page, { bubbleIndex: 0, text: "weather" }),
      ).rejects.toThrow();
    },
  );
  it("accepts the associated canonical weather values", async () => {
    const page = pageFor("tool-rendering", {
      ...empty(),
      weather: [
        card("68°F\nSunny", {
          "weather-city": ["San Francisco"],
          "weather-humidity": ["55%"],
          "weather-wind": ["10 mph"],
        }),
      ],
    });
    const turn = buildToolsAgentTurns("tool-rendering")[0]!;
    await turn.preFill!(page);
    await expect(
      turn.assertions!(page, { bubbleIndex: 0, text: "weather" }),
    ).resolves.toBeUndefined();
  });
  it("rejects reasoning-chain stock cards with swapped ticker prices", async () => {
    const stocks = [
      { ticker: "AAPL", price_usd: 412.18, change_pct: 1.08 },
      { ticker: "MSFT", price_usd: 338.37, change_pct: -2.96 },
    ];
    const page = pageFor("tool-rendering-reasoning-chain", {
      ...empty(),
      reasoning: [
        card("New concrete reasoning about the two separate stock quotes", {}),
      ],
      chain: stocks.map((value) => ({
        ...card("stock", {}),
        tool: "get_stock_price",
        pre: [JSON.stringify({ ticker: value.ticker }), JSON.stringify(value)],
      })),
    });
    const turn = buildToolsAgentTurns("tool-rendering-reasoning-chain")[0]!;
    await turn.preFill!(page);
    await expect(
      turn.assertions!(page, { bubbleIndex: 0, text: "AAPL MSFT" }),
    ).rejects.toThrow("stock comparison");
  });
  it("keeps all three reasoning-chain pills in one conversation", () => {
    const turns = buildToolsAgentTurns("tool-rendering-reasoning-chain");
    expect(turns.map((t) => t.action?.buttonName)).toEqual([
      "Compare two stocks",
      "Chain of dice rolls",
      "Flights + destination weather",
    ]);
    expect(
      turns.every(
        (t) => t.action?.expectedDispatchedPrompt === t.input && t.assertions,
      ),
    ).toBe(true);
  });
  it("keeps an iframe-only MCP result unverified", async () => {
    const page = pageFor("mcp-apps", { ...empty(), iframe: [card("", {})] });
    const turn = buildToolsAgentTurns("mcp-apps")[0]!;
    await turn.preFill!(page);
    await expect(
      turn.assertions!(page, { bubbleIndex: 0, text: "Drawing" }),
    ).rejects.toThrow(UnverifiedDefinitionError);
  });
});
