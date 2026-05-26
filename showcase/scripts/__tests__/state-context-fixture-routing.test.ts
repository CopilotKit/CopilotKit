import { describe, expect, it } from "vitest";
import path from "node:path";
import { globSync } from "glob";
import { loadFixtureFile, matchFixture } from "@copilotkit/aimock";
import type {
  ChatCompletionRequest,
  Fixture,
  TextResponse,
} from "@copilotkit/aimock";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

// Load D6 fixtures only for this test. State/context demos are D6 features;
// D4 chat fixtures contain broad substring matchers (e.g. "Say hi") that
// shadow the more specific D6 shared-state fixtures when loaded together.
// Migration files (_migrated-from-*.json) are excluded because they contain
// systemMessage-based discriminators that loadFixtureFile strips.
function loadBundledFixtures(): Fixture[] {
  const fixtureFiles = [
    ...globSync("showcase/aimock/shared/*.json", {
      cwd: REPO_ROOT,
      absolute: true,
    }).filter((f) => !path.basename(f).startsWith("_migrated")),
    ...globSync("showcase/aimock/d6/langgraph-python/*.json", {
      cwd: REPO_ROOT,
      absolute: true,
    }),
  ];
  return fixtureFiles.flatMap((f) => loadFixtureFile(f));
}

function request(
  userMessage: string,
  systemMessage: string,
): ChatCompletionRequest {
  return {
    model: "gpt-5.4",
    messages: [
      { role: "system", content: systemMessage },
      { role: "user", content: userMessage },
    ],
    // D6 fixtures use match.context for per-integration scoping; aimock's
    // matchFixture checks req._context against it.
    _context: "langgraph-python",
  } as ChatCompletionRequest;
}

const DEFAULT_SHARED_STATE_SYSTEM = `
Application State
{
  "preferences": {
    "name": "",
    "tone": "casual",
    "language": "English",
    "interests": []
  },
  "notes": []
}
`;

const DEFAULT_READONLY_CONTEXT_SYSTEM = `
## Context from the application
The currently logged-in user's display name:
Atai
The user's IANA timezone (used when mentioning times):
America/Los_Angeles
The user's recent activity in the app, newest first:
["Viewed the pricing page","Watched the product demo video"]
`;

// D6 fixtures use integration-level context scoping (X-AIMock-Context header)
// instead of systemMessage-based differentiation. At the fixture level, the
// same userMessage matches regardless of system message content — the routing
// to the correct integration's fixtures happens at the HTTP layer.
//
// This test verifies that the default demo fixtures exist and produce
// semantically correct content for the reference integration.

describe("state/context fixture routing", () => {
  it("shared-state default preferences match with correct content", () => {
    const fixtures = loadBundledFixtures();

    const defaultMatch = matchFixture(
      fixtures,
      request("Say hi and introduce yourself.", DEFAULT_SHARED_STATE_SYSTEM),
    );
    expect(defaultMatch).not.toBeNull();
    expect((defaultMatch!.response as TextResponse).content).toContain(
      "shared-state co-pilot",
    );
  });

  it("readonly context defaults match with correct content", () => {
    const fixtures = loadBundledFixtures();

    const defaultMatch = matchFixture(
      fixtures,
      request(
        "What do you know about me from my context?",
        DEFAULT_READONLY_CONTEXT_SYSTEM,
      ),
    );
    expect(defaultMatch).not.toBeNull();
    expect((defaultMatch!.response as TextResponse).content).toContain("Atai");
  });

  it("readonly context follow-up question matches", () => {
    const fixtures = loadBundledFixtures();

    const followUp = matchFixture(
      fixtures,
      request(
        "Based on my recent activity, what should I try next?",
        DEFAULT_READONLY_CONTEXT_SYSTEM,
      ),
    );
    expect(followUp).not.toBeNull();
    expect((followUp!.response as TextResponse).content).toBeTruthy();
  });
});
