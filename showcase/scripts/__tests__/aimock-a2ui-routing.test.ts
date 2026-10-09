import { readFileSync } from "node:fs";
import path from "node:path";

import { matchFixture } from "@copilotkit/aimock";
import { describe, expect, it } from "vitest";

/**
 * built-in-agent's A2UI demos (declarative-gen-ui, a2ui-recovery) run TWO LLM
 * calls per pill through one runtime:
 *
 *   1. OUTER — the agent, declaring the `generate_a2ui` tool, decides to draw
 *      and emits a tool call whose only arg is a `brief` string.
 *   2. SECONDARY — inside the tool body, a tool-less design call turns that
 *      brief into a flat A2UI catalog object.
 *   3. OUTER again — a short narration once the tool result returns.
 *
 * The secondary fixtures used to be keyed on `match.responseFormat:
 * "json_object"`. That matcher is DEAD for this backend. The agent talks to the
 * OpenAI *Responses* API, where JSON mode is `text.format` — and aimock has no
 * `text.format` handling at all: `responsesToCompletionRequest` forwards only a
 * top-level `response_format` (checked in 1.19.1, which omits even that, and
 * 1.37.4, which forwards it), a key the Responses API does not accept and this
 * client does not send. So `effective.response_format?.type` was always
 * undefined, `router`'s `match.responseFormat` check skipped the fixture, the
 * secondary call never matched, the surface never painted, and D5 (1P) went red
 * — while the live demo, which uses a real LLM and no fixtures, worked fine.
 * Hence "D4 on the dashboard, works in staging".
 *
 * The replacement discriminator is the tool list, which aimock DOES normalize
 * out of a Responses request (`responsesToolsToCompletionsTools`): the outer
 * call declares `generate_a2ui`, the secondary call declares nothing. Outer
 * fixtures assert `toolName`, and the secondary fixtures sit last in the file so
 * they cannot win an outer request whose pill text happens to contain the brief
 * (true for several pills — e.g. "Build my Q2 revenue summary …" contains the
 * secondary's "Q2 revenue summary").
 *
 * These tests drive aimock's real `matchFixture`, so they fail if the routing
 * regresses — including if a `responseFormat` matcher is reintroduced.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const FIXTURE_FILES = [
  "showcase/aimock/d6/built-in-agent/gen-ui-declarative.json",
  "showcase/aimock/d6/built-in-agent/a2ui-recovery.json",
];

type RawMatch = {
  userMessage?: string;
  toolName?: string;
  context?: string;
  hasToolResult?: boolean;
  turnIndex?: number;
  responseFormat?: string;
};
type RawFixture = { match: RawMatch; response: Record<string, unknown> };

function load(file: string): RawFixture[] {
  const doc = JSON.parse(
    readFileSync(path.resolve(REPO_ROOT, file), "utf8"),
  ) as { fixtures: RawFixture[] };
  return doc.fixtures;
}

/**
 * Fixtures as aimock holds them after loading. `context` is a routing key
 * consumed before matching (`--context-field`), so it is stripped here the way
 * the loader does; every fixture in these files shares one context.
 */
function toRuntimeFixtures(raw: RawFixture[]) {
  return raw.map((fx) => {
    const { context: _context, ...match } = fx.match;
    void _context;
    return { match, response: fx.response };
  });
}

/**
 * A Responses-API request as aimock sees it after normalization.
 * `assistantTurns` pads the history so `match.turnIndex` (a count of assistant
 * messages) resolves — a2ui-recovery keys its outer fixtures that way.
 */
function request(opts: {
  userMessage: string;
  declaresA2uiTool: boolean;
  assistantTurns?: number;
}) {
  const history = Array.from({ length: opts.assistantTurns ?? 0 }, () => ({
    role: "assistant" as const,
    content: "…",
  }));
  return {
    model: "gpt-5.4",
    messages: [
      ...history,
      { role: "user" as const, content: opts.userMessage },
    ],
    // `responsesToolsToCompletionsTools` produces this shape; a tool-less
    // Responses request yields `undefined`, which the matcher reads as [].
    tools: opts.declaresA2uiTool
      ? [
          {
            type: "function" as const,
            function: {
              name: "generate_a2ui",
              description: "",
              parameters: {},
            },
          },
        ]
      : undefined,
  };
}

function briefOf(fx: RawFixture): string | undefined {
  const toolCalls = fx.response.toolCalls as
    | Array<{ name?: string; arguments?: unknown }>
    | undefined;
  const args = toolCalls?.[0]?.arguments;
  if (args === undefined) return undefined;
  const parsed = typeof args === "string" ? JSON.parse(args) : args;
  return (parsed as { brief?: string }).brief;
}

// matchFixture(fixtures, req, ...) — fixtures first.
function route(runtime: ReturnType<typeof toRuntimeFixtures>, req: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return matchFixture(runtime as any, req as any);
}

describe.each(FIXTURE_FILES)("%s", (file) => {
  const raw = load(file);
  const runtime = toRuntimeFixtures(raw);
  // Turn-1 outer fixtures: the ones that hand back a `generate_a2ui` call, and
  // so carry the exact brief their secondary pass will be asked to design.
  const turnOnes = raw.filter((fx) => briefOf(fx) !== undefined);

  it("has no responseFormat matcher left (dead through the Responses API)", () => {
    expect(raw.filter((fx) => fx.match.responseFormat !== undefined)).toEqual(
      [],
    );
  });

  it("guards every tool-call fixture with the generate_a2ui tool", () => {
    const unguarded = turnOnes
      .filter((fx) => fx.match.toolName !== "generate_a2ui")
      .map((fx) => fx.match.userMessage);
    expect(unguarded).toEqual([]);
  });

  it("covers at least one pill", () => {
    expect(turnOnes.length).toBeGreaterThan(0);
  });

  it.each(turnOnes.map((fx) => [fx.match.userMessage ?? "", fx] as const))(
    "routes both calls for %s",
    (pillText, outerFixture) => {
      const brief = briefOf(outerFixture)!;

      // 1. Outer call: declares the tool, sends the pill text.
      const outerHit = route(
        runtime,
        request({
          userMessage: pillText,
          declaresA2uiTool: true,
          assistantTurns: outerFixture.match.turnIndex ?? 0,
        }),
      );
      expect(
        outerHit,
        `no fixture matched the outer call for "${pillText}"`,
      ).not.toBeNull();
      expect(outerHit!.response).toHaveProperty("toolCalls");

      // 2. Secondary call: no tools, sends the brief. This is the one that was
      //    unreachable — it must resolve to a design response, NOT a tool call.
      const secondaryHit = route(
        runtime,
        request({ userMessage: brief, declaresA2uiTool: false }),
      );
      expect(
        secondaryHit,
        `no fixture matched the secondary design call for brief "${brief}"`,
      ).not.toBeNull();
      expect(secondaryHit!.response).not.toHaveProperty("toolCalls");
    },
  );
});
