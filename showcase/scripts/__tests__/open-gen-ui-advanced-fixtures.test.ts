import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// Regression guard for the three "open-gen-ui-advanced" interactive pills.
//
// Each pill's `userMessage` doubles as a fixture key in
// `showcase/aimock/d5-all.json`. The fixture's `generateSandboxedUi`
// tool-call arguments MUST include `jsFunctions` that wire up the in-iframe
// click handlers — otherwise the iframe renders HTML+CSS but every button
// is a no-op (the regression that motivated this test).
//
// Fixture aimock schema validation (in `aimock-fixtures.test.ts`) catches
// structural issues but not semantic ones — it doesn't know that the
// Calculator's HTML needs JS to do anything. This test plugs that gap.

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const FIXTURE_PATH = path.join(REPO_ROOT, "showcase", "aimock", "d5-all.json");

type Fixture = {
  match: { userMessage?: string; toolCallId?: string };
  response: {
    toolCalls?: Array<{ name: string; arguments: string }>;
    content?: string;
  };
};

let fixturesByMessage: Record<string, Fixture[]> = {};

beforeAll(() => {
  const raw = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
  for (const f of raw.fixtures as Fixture[]) {
    const key = f.match.userMessage;
    if (!key) continue;
    (fixturesByMessage[key] ??= []).push(f);
  }
});

const findToolCallArgs = (userMessage: string): Record<string, unknown> => {
  const matches = fixturesByMessage[userMessage] ?? [];
  // We want the fixture that returns the tool call (not the follow-up
  // `content` reply that uses toolCallId as a discriminator).
  const withToolCall = matches.find(
    (f) =>
      !f.match.toolCallId &&
      f.response.toolCalls?.[0]?.name === "generateSandboxedUi",
  );
  if (!withToolCall) {
    throw new Error(
      `No generateSandboxedUi fixture for userMessage="${userMessage}" (found ${matches.length} candidates)`,
    );
  }
  return JSON.parse(withToolCall.response.toolCalls![0].arguments);
};

describe("open-gen-ui-advanced interactive fixtures wire jsFunctions to host bridges", () => {
  it("Calculator pill calls evaluateExpression via jsFunctions", () => {
    const args = findToolCallArgs("Calculator (calls evaluateExpression)");
    expect(
      args.jsFunctions,
      "Calculator fixture missing jsFunctions — iframe buttons would be no-ops",
    ).toBeTypeOf("string");
    expect(args.jsFunctions as string).toContain(
      "Websandbox.connection.remote.evaluateExpression",
    );
  });

  it("Ping the host pill calls notifyHost via jsFunctions", () => {
    const args = findToolCallArgs("Ping the host (calls notifyHost)");
    expect(
      args.jsFunctions,
      "Ping-the-host fixture missing jsFunctions — iframe button would be a no-op",
    ).toBeTypeOf("string");
    expect(args.jsFunctions as string).toContain(
      "Websandbox.connection.remote.notifyHost",
    );
  });

  it("Inline expression evaluator pill calls evaluateExpression via jsFunctions", () => {
    const args = findToolCallArgs("Inline expression evaluator");
    expect(
      args.jsFunctions,
      "Inline-evaluator fixture missing jsFunctions — Evaluate button would be a no-op",
    ).toBeTypeOf("string");
    expect(args.jsFunctions as string).toContain(
      "Websandbox.connection.remote.evaluateExpression",
    );
  });
});
