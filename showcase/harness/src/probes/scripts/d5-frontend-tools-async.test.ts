import type { StateToolsContract } from "./_pill-contracts-state-tools.js";
import { getD5Script } from "../helpers/d5-registry.js";
import {
  STATE_TOOLS_CONTRACTS,
  checkStateToolsResult,
} from "./_pill-contracts-state-tools.js";
import { describe, expect, it } from "vitest";
import { buildTurns as canonicalBuildTurns } from "./d5-frontend-tools-async.js";

const context = {
  integrationSlug: "langgraph-python",
  featureType: "frontend-tools-async",
  baseUrl: "http://localhost:39200",
} as const;

describe("frontend-tools-async canonical pill contract", () => {
  it("accounts for all three exact canonical controls", () => {
    const turns = canonicalBuildTurns(context);
    expect(turns.map((turn) => turn.action?.buttonName)).toEqual([
      "Find project-planning notes",
      "Search for 'auth'",
      "What do I have about reading?",
    ]);
    expect(new Set(turns.map((turn) => turn.action?.id)).size).toBe(3);
    for (const turn of turns) {
      expect(turn.action?.kind).toBe("pill");
      expect(turn.action?.expectedDispatchedPrompt).toBe(turn.input);
      expect(turn.action?.submission).toEqual({ kind: "immediate" });
      expect(turn.assertions).toBeTypeOf("function");
      expect(turn.skipFill).toBeUndefined();
      expect(turn.skipSend).toBeUndefined();
    }
  });
  it("uses identical canonical controls across integrations", () => {
    const canonical = canonicalBuildTurns(context).map(({ input, action }) => ({
      input,
      action,
    }));
    for (const integrationSlug of [
      "ag2",
      "agno",
      "spring-ai",
      "claude-sdk-python",
    ]) {
      expect(
        canonicalBuildTurns({ ...context, integrationSlug }).map(
          ({ input, action }) => ({ input, action }),
        ),
      ).toEqual(canonical);
    }
  });
});

describe("strict visible-result regressions", () => {
  const contracts: readonly StateToolsContract[] =
    STATE_TOOLS_CONTRACTS["frontend-tools-async"];
  it("registers the functional builder with all required results", () => {
    expect(getD5Script("frontend-tools-async")).toBeDefined();
  });
  for (const contract of contracts) {
    it(`${contract.id} accepts only the established exact result`, () => {
      const result = {
        texts: [contract.texts.join(" ")],
        attributes: [contract.value ?? null],
        pills: [],
        noteIds: [Array.from(contract.noteIds ?? [])],
        noteRows: [Array.from(contract.noteRows ?? [])],
        backgroundMatches: [true],
      };
      if (contract.unresolved) {
        expect(() => checkStateToolsResult(contract, result, 0)).toThrow(
          contract.unresolved,
        );
      } else {
        expect(() => checkStateToolsResult(contract, result, 0)).not.toThrow();
        expect(() =>
          checkStateToolsResult(
            contract,
            { ...result, texts: ["Wrong result"], attributes: ["#4f46e5"] },
            0,
          ),
        ).toThrow();
        if (
          !contract.attribute &&
          contract.selector !== '[data-testid="document-content"]'
        ) {
          expect(() => checkStateToolsResult(contract, result, 1)).toThrow();
        }
        const noteIds = contract.noteIds;
        if (noteIds) {
          expect(() =>
            checkStateToolsResult(
              contract,
              { ...result, noteIds: [[...noteIds, "note-n7"]] },
              0,
            ),
          ).toThrow();
        }
      }
    });
    it(`${contract.id} rejects empty, hidden or stale results`, () => {
      expect(() =>
        checkStateToolsResult(
          contract,
          {
            texts: [],
            attributes: [],
            pills: [],
            noteIds: [],
            noteRows: [],
            backgroundMatches: [],
          },
          0,
        ),
      ).toThrow();
    });
  }
});
