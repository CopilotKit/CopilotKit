import { describe, it, expect } from "vitest";
import {
  groupByContext,
  groupByDemoCell,
  mergeIntoFixtureFile,
} from "../merge-recorded-fixtures";
import type {
  Fixture,
  FixtureFile,
  FixtureMeta,
} from "../merge-recorded-fixtures";

describe("merge-recorded-fixtures", () => {
  // -------------------------------------------------------------------
  // groupByContext
  // -------------------------------------------------------------------

  describe("groupByContext", () => {
    it("groups fixtures by match.context field", () => {
      const fixtures: Fixture[] = [
        { match: { context: "lgp", userMessage: "hi" }, response: {} },
        { match: { context: "lgt", userMessage: "hi" }, response: {} },
        { match: { context: "lgp", userMessage: "bye" }, response: {} },
      ];
      const grouped = groupByContext(fixtures);
      expect(grouped.get("lgp")?.length).toBe(2);
      expect(grouped.get("lgt")?.length).toBe(1);
    });

    it("places fixtures without context under __shared__", () => {
      const fixtures: Fixture[] = [
        { match: { userMessage: "hello" }, response: {} },
        { match: { context: "lgp", userMessage: "hi" }, response: {} },
      ];
      const grouped = groupByContext(fixtures);
      expect(grouped.get("__shared__")?.length).toBe(1);
      expect(grouped.get("lgp")?.length).toBe(1);
    });

    it("returns empty map for empty input", () => {
      const grouped = groupByContext([]);
      expect(grouped.size).toBe(0);
    });

    it("preserves fixture order within each group", () => {
      const fixtures: Fixture[] = [
        { match: { context: "a", userMessage: "first" }, response: {} },
        { match: { context: "a", userMessage: "second" }, response: {} },
        { match: { context: "a", userMessage: "third" }, response: {} },
      ];
      const grouped = groupByContext(fixtures);
      const group = grouped.get("a")!;
      expect(group[0].match.userMessage).toBe("first");
      expect(group[1].match.userMessage).toBe("second");
      expect(group[2].match.userMessage).toBe("third");
    });
  });

  // -------------------------------------------------------------------
  // groupByDemoCell
  // -------------------------------------------------------------------

  describe("groupByDemoCell", () => {
    it("groups fixtures by _comment prefix on the fixture", () => {
      const fixtures: Fixture[] = [
        {
          _comment: "agentic-chat turn 1",
          match: { userMessage: "hi" },
          response: {},
        },
        {
          _comment: "agentic-chat turn 2",
          match: { userMessage: "more" },
          response: {},
        },
        {
          _comment: "hitl turn 1",
          match: { userMessage: "hi" },
          response: {},
        },
      ];
      const grouped = groupByDemoCell(fixtures);
      expect(grouped.get("agentic-chat")?.length).toBe(2);
      expect(grouped.get("hitl")?.length).toBe(1);
    });

    it("falls back to match._comment when top-level _comment is absent", () => {
      const fixtures: Fixture[] = [
        {
          match: { _comment: "gen-ui step 1", userMessage: "hi" },
          response: {},
        },
        {
          match: { _comment: "gen-ui step 2", userMessage: "more" },
          response: {},
        },
      ];
      const grouped = groupByDemoCell(fixtures);
      expect(grouped.get("gen-ui")?.length).toBe(2);
    });

    it("places fixtures without _comment under __unknown__", () => {
      const fixtures: Fixture[] = [
        { match: { userMessage: "hello" }, response: {} },
      ];
      const grouped = groupByDemoCell(fixtures);
      expect(grouped.get("__unknown__")?.length).toBe(1);
    });

    it("handles mixed _comment locations", () => {
      const fixtures: Fixture[] = [
        {
          _comment: "demo-a turn 1",
          match: { userMessage: "hi" },
          response: {},
        },
        {
          match: { _comment: "demo-b step 1", userMessage: "bye" },
          response: {},
        },
        { match: { userMessage: "no comment" }, response: {} },
      ];
      const grouped = groupByDemoCell(fixtures);
      expect(grouped.get("demo-a")?.length).toBe(1);
      expect(grouped.get("demo-b")?.length).toBe(1);
      expect(grouped.get("__unknown__")?.length).toBe(1);
    });
  });

  // -------------------------------------------------------------------
  // mergeIntoFixtureFile
  // -------------------------------------------------------------------

  describe("mergeIntoFixtureFile", () => {
    const meta: FixtureMeta = {
      _comment: "test merge",
      _recordedAt: "2026-01-01T00:00:00Z",
      _source: "test",
    };

    it("creates a new file when existing is null", () => {
      const incoming: Fixture[] = [
        { match: { userMessage: "hi" }, response: { content: "hello" } },
      ];
      const result = mergeIntoFixtureFile(null, incoming, meta);
      expect(result.fixtures.length).toBe(1);
      expect(result._meta).toEqual(meta);
    });

    it("merges without duplicates (incoming wins)", () => {
      const existing: FixtureFile = {
        fixtures: [
          {
            match: { userMessage: "hi" },
            response: { content: "old" },
          },
          {
            match: { userMessage: "unique-existing" },
            response: { content: "keep" },
          },
        ],
      };
      const incoming: Fixture[] = [
        {
          match: { userMessage: "hi" },
          response: { content: "new" },
        },
      ];
      const result = mergeIntoFixtureFile(existing, incoming, meta);
      // "unique-existing" kept, "hi" replaced by incoming.
      expect(result.fixtures.length).toBe(2);
      const hiFixture = result.fixtures.find(
        (f) => f.match.userMessage === "hi",
      );
      expect(hiFixture?.response.content).toBe("new");
    });

    it("deduplicates using turnIndex and hasToolResult", () => {
      const existing: FixtureFile = {
        fixtures: [
          {
            match: {
              userMessage: "hi",
              turnIndex: 0,
              hasToolResult: false,
            },
            response: { content: "old-turn-0" },
          },
          {
            match: {
              userMessage: "hi",
              turnIndex: 1,
              hasToolResult: true,
            },
            response: { content: "old-turn-1" },
          },
        ],
      };
      const incoming: Fixture[] = [
        {
          match: {
            userMessage: "hi",
            turnIndex: 0,
            hasToolResult: false,
          },
          response: { content: "new-turn-0" },
        },
      ];
      const result = mergeIntoFixtureFile(existing, incoming, meta);
      // turn-0 replaced, turn-1 kept.
      expect(result.fixtures.length).toBe(2);
      const turn0 = result.fixtures.find((f) => f.match.turnIndex === 0);
      expect(turn0?.response.content).toBe("new-turn-0");
      const turn1 = result.fixtures.find((f) => f.match.turnIndex === 1);
      expect(turn1?.response.content).toBe("old-turn-1");
    });
  });
});
