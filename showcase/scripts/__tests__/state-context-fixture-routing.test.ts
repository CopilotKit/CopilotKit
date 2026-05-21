import { describe, expect, it } from "vitest";
import path from "node:path";
import { loadFixtureFile, matchFixture } from "@copilotkit/aimock";
import type {
  ChatCompletionRequest,
  Fixture,
  TextResponse,
} from "@copilotkit/aimock";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const AIMOCK_DIR = path.join(REPO_ROOT, "showcase", "aimock");

// Mirror showcase/docker-compose.local.yml's aimock command. The order is
// load-bearing because aimock uses first-match-wins.
const FIXTURE_FILES = ["d5-all.json", "smoke.json", "feature-parity.json"];

function loadBundledFixtures(): Fixture[] {
  return FIXTURE_FILES.flatMap((f) =>
    loadFixtureFile(path.join(AIMOCK_DIR, f)),
  );
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
  };
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

const CHANGED_SHARED_STATE_SYSTEM = `
Application State
{
  "preferences": {
    "name": "Jamie",
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

const CHANGED_READONLY_CONTEXT_SYSTEM = `
## Context from the application
The currently logged-in user's display name:
Jamie
The user's IANA timezone (used when mentioning times):
Asia/Tokyo
The user's recent activity in the app, newest first:
["Viewed the docs"]
`;

const SENTINEL_READONLY_CONTEXT_SYSTEM = `
## Context from the application
The currently logged-in user's display name:
CTX-PROBE-7g3kqz
The user's IANA timezone (used when mentioning times):
America/Los_Angeles
The user's recent activity in the app, newest first:
["Viewed the pricing page","Watched the product demo video"]
`;

describe("state/context fixture routing", () => {
  it("shared-state default preferences match, but edited preferences miss all bundled fixtures", () => {
    const fixtures = loadBundledFixtures();

    const defaultMatch = matchFixture(
      fixtures,
      request("Say hi and introduce yourself.", DEFAULT_SHARED_STATE_SYSTEM),
    );
    expect(defaultMatch).not.toBeNull();
    expect((defaultMatch!.response as TextResponse).content).toContain(
      "shared-state co-pilot",
    );

    const changedMatch = matchFixture(
      fixtures,
      request("Say hi and introduce yourself.", CHANGED_SHARED_STATE_SYSTEM),
    );
    expect(
      changedMatch,
      "edited shared-state preferences must not fall into stale d5-all or generic feature-parity fixtures",
    ).toBeNull();
  });

  it("readonly context defaults match, but edited name/timezone miss all bundled fixtures", () => {
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

    const changedMatch = matchFixture(
      fixtures,
      request(
        "What do you know about me from my context?",
        CHANGED_READONLY_CONTEXT_SYSTEM,
      ),
    );
    expect(
      changedMatch,
      "edited readonly context must proxy to the real model instead of serving the default Atai fixture",
    ).toBeNull();

    const sentinelMatch = matchFixture(
      fixtures,
      request(
        "What do you know about me from my context?",
        SENTINEL_READONLY_CONTEXT_SYSTEM,
      ),
    );
    expect(sentinelMatch).not.toBeNull();
    expect((sentinelMatch!.response as TextResponse).content).toContain(
      "CTX-PROBE-7g3kqz",
    );
  });
});
