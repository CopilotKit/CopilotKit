/**
 * Guardrail for aimock fixture drift.
 *
 * Background: aimock serves deterministic responses in prod to save LLM cost.
 * Fixtures substring-match the user message and return a hardcoded tool call.
 * When a fixture returns a tool name that the matched demo's agent doesn't
 * actually register, the tool call dangles and the UI renders nothing.
 * That's what broke gen-ui-tool-based and beautiful-chat in prod before the
 * fixture cleanup landed. This validator catches that class of drift.
 */
import { describe, it, expect } from "vitest";
import {
  validate,
  type Fixture,
  type DemoSurface,
  type Violation,
} from "../validate-fixture-tool-surface";

const demoGenUiToolBased: DemoSurface = {
  slug: "langgraph-python",
  demoId: "gen-ui-tool-based",
  agentId: "gen-ui-tool-based",
  suggestions: [
    "Show me a pie chart of website traffic by source.",
    "Show me a bar chart of quarterly sales for Q1, Q2, Q3, Q4.",
  ],
  tools: ["render_pie_chart", "render_bar_chart"],
};

const demoBeautifulChat: DemoSurface = {
  slug: "langgraph-python",
  demoId: "beautiful-chat",
  agentId: "beautiful-chat",
  suggestions: [
    "Show me a pie chart of our revenue distribution by category.",
    "Toggle the app theme using the toggleTheme tool.",
  ],
  tools: ["query_data", "pieChart", "barChart", "scheduleTime", "toggleTheme"],
};

describe("validateFixtureToolSurface", () => {
  it("flags a fixture whose tool name isn't registered by the matched demo", () => {
    const badFixture: Fixture = {
      match: { userMessage: "pie chart" },
      response: {
        toolCalls: [
          {
            name: "query_data",
            arguments: '{"query":"revenue by category"}',
          },
        ],
      },
    };

    const violations = validate([badFixture], [demoGenUiToolBased]);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject<Partial<Violation>>({
      fixtureMatch: "pie chart",
      fixtureTool: "query_data",
      demo: { slug: "langgraph-python", demoId: "gen-ui-tool-based" },
    });
  });

  it("accepts a fixture whose tool name is in the matched demo's surface", () => {
    const goodFixture: Fixture = {
      match: { userMessage: "pie chart of website traffic by source" },
      response: {
        toolCalls: [{ name: "render_pie_chart", arguments: "{}" }],
      },
    };

    const violations = validate([goodFixture], [demoGenUiToolBased]);

    expect(violations).toEqual([]);
  });

  it("ignores content-only fixtures (no toolCalls → no drift possible)", () => {
    const contentFixture: Fixture = {
      match: { userMessage: "hello" },
      response: { content: "Hi there!" },
    };

    const violations = validate([contentFixture], [demoGenUiToolBased]);

    expect(violations).toEqual([]);
  });

  it("ignores fixtures that don't match any demo's suggestions", () => {
    const orphanFixture: Fixture = {
      match: { userMessage: "something no suggestion contains" },
      response: {
        toolCalls: [{ name: "made_up_tool", arguments: "{}" }],
      },
    };

    const violations = validate([orphanFixture], [demoGenUiToolBased]);

    // Ad-hoc prompts that users type manually may legitimately fire these
    // fixtures with no matching suggestion. That's out of scope for this
    // validator — we only assert "fixtures that THE SHOWCASE ITSELF TRIGGERS
    // via its own suggestion pills line up with the agent's tool surface".
    expect(violations).toEqual([]);
  });

  it("matches case-insensitively", () => {
    const badFixture: Fixture = {
      match: { userMessage: "PIE CHART" },
      response: {
        toolCalls: [{ name: "query_data", arguments: "{}" }],
      },
    };

    const violations = validate([badFixture], [demoGenUiToolBased]);

    expect(violations).toHaveLength(1);
    expect(violations[0].fixtureMatch).toBe("PIE CHART");
  });

  it("reports a violation per (fixture, matching demo) pair when multiple demos match", () => {
    const genericFixture: Fixture = {
      match: { userMessage: "pie chart" },
      response: {
        toolCalls: [{ name: "query_data", arguments: "{}" }],
      },
    };

    const violations = validate(
      [genericFixture],
      [demoGenUiToolBased, demoBeautifulChat],
    );

    // gen-ui-tool-based does NOT have query_data → 1 violation
    // beautiful-chat DOES have query_data → no violation
    expect(violations).toHaveLength(1);
    expect(violations[0].demo.demoId).toBe("gen-ui-tool-based");
  });

  it("reports one violation per unregistered tool in a multi-tool response", () => {
    const multiToolFixture: Fixture = {
      match: { userMessage: "pie chart of website traffic by source" },
      response: {
        toolCalls: [
          { name: "render_pie_chart", arguments: "{}" }, // OK
          { name: "query_data", arguments: "{}" }, // drift
          { name: "generate_a2ui", arguments: "{}" }, // drift
        ],
      },
    };

    const violations = validate([multiToolFixture], [demoGenUiToolBased]);

    expect(violations).toHaveLength(2);
    const badTools = violations.map((v) => v.fixtureTool).sort();
    expect(badTools).toEqual(["generate_a2ui", "query_data"]);
  });
});
