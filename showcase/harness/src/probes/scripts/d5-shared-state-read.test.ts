import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";

// Side-effect import: registers the script under `shared-state-read`.
import {
  EDITED_RECIPE_TITLE,
  RECIPE_TITLE_SELECTOR,
  TURN_1_INPUT,
  buildTurns,
  editRecipeTitle,
} from "./d5-shared-state-read.js";

const CTX: D5BuildContext = {
  integrationSlug: "langgraph-python",
  featureType: "shared-state-read",
  baseUrl: "https://showcase-langgraph-python.example.com",
};

const D6_FIXTURES_DIR = fileURLToPath(
  new URL("../../../../aimock/d6/", import.meta.url),
);

/** A page whose title input shows `shownTitle` after any fill. */
function makePage(shownTitle: (typed: string | null) => string | null): {
  page: Page;
  fills: Array<{ selector: string; value: string }>;
} {
  const fills: Array<{ selector: string; value: string }> = [];
  let typed: string | null = null;
  const page: Page = {
    async waitForSelector() {
      /* recipe card is mounted */
    },
    async fill(selector, value) {
      fills.push({ selector, value });
      typed = value;
    },
    async press() {
      /* no-op */
    },
    async evaluate() {
      return shownTitle(typed) as never;
    },
  };
  return { page, fills };
}

interface Fixture {
  match: { userMessage?: string; systemMessage?: string | string[] };
}

async function readReadFixtures(): Promise<Record<string, Fixture[]>> {
  const out: Record<string, Fixture[]> = {};
  for (const slug of await fs.readdir(D6_FIXTURES_DIR)) {
    const file = path.join(D6_FIXTURES_DIR, slug, "shared-state-read.json");
    try {
      const parsed = JSON.parse(await fs.readFile(file, "utf8")) as {
        fixtures: Fixture[];
      };
      out[slug] = parsed.fixtures;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
  }
  return out;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("d5-shared-state-read script", () => {
  it("registers for shared-state-read with its fixture file", () => {
    const script = getD5Script("shared-state-read");
    expect(script?.featureTypes).toEqual(["shared-state-read"]);
    expect(script?.fixtureFile).toBe("shared-state-read.json");
  });

  it("edits the recipe title before sending the first prompt", () => {
    const [turn1, turn2] = buildTurns(CTX);
    expect(turn1?.input).toBe(TURN_1_INPUT);
    expect(turn1?.preFill).toBe(editRecipeTitle);
    expect(turn2?.preFill).toBeUndefined();
  });

  it("types the edited title into the form and waits for it to stick", async () => {
    const { page, fills } = makePage((typed) => typed);
    await editRecipeTitle(page);
    expect(fills).toEqual([
      { selector: RECIPE_TITLE_SELECTOR, value: EDITED_RECIPE_TITLE },
    ]);
  });

  it("fails when the controlled input reverts the edit", async () => {
    vi.useFakeTimers();
    const { page } = makePage(() => "Make Your Recipe");
    const outcome = editRecipeTitle(page).then(
      () => null,
      (err: Error) => err,
    );
    await vi.advanceTimersByTimeAsync(6_000);
    const err = await outcome;
    expect(err?.message).toContain("agent.setState did not accept the edit");
  });
});

describe("shared-state-read fixtures gated on the recipe edit", () => {
  it("gate on the probe's edited title wherever they check the system prompt", async () => {
    const bySlug = await readReadFixtures();
    const gated = Object.entries(bySlug).flatMap(([slug, fixtures]) =>
      fixtures
        .filter((fixture) => fixture.match.systemMessage !== undefined)
        .map((fixture) => ({
          slug,
          systemMessage: fixture.match.systemMessage,
        })),
    );
    // Not vacuous: at least one integration proves the edit reaches the model.
    expect(gated.length).toBeGreaterThan(0);
    for (const { slug, systemMessage } of gated) {
      const needles = Array.isArray(systemMessage)
        ? systemMessage
        : [systemMessage];
      expect(
        needles.some((needle) => needle?.includes(EDITED_RECIPE_TITLE)),
        `${slug}/shared-state-read.json gates on ${JSON.stringify(systemMessage)}`,
      ).toBe(true);
    }
  });
});
