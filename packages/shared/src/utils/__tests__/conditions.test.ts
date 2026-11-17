import { describe, it, expect } from "vitest";
import type {
  Condition,
  ComparisonCondition,
  LogicalCondition,
  ExistenceCondition,
} from "../conditions";
import { executeConditions } from "../conditions";

describe("executeConditions", () => {
  it("returns true when conditions is empty or undefined", () => {
    expect(executeConditions({ value: { a: 1 } })).toBe(true);
    expect(executeConditions({ conditions: [], value: { a: 1 } })).toBe(true);
  });

  it("treats multiple conditions as an implicit AND", () => {
    const conditions: Condition[] = [
      { rule: "EQUALS", path: "a", value: 1 },
      { rule: "EQUALS", path: "b", value: 2 },
    ];
    expect(executeConditions({ conditions, value: { a: 1, b: 2 } })).toBe(true);
    expect(executeConditions({ conditions, value: { a: 1, b: 3 } })).toBe(
      false,
    );
  });

  describe("comparison rules", () => {
    it("EQUALS and NOT_EQUALS", () => {
      const eq: ComparisonCondition = { rule: "EQUALS", path: "a", value: 5 };
      const neq: ComparisonCondition = {
        rule: "NOT_EQUALS",
        path: "a",
        value: 5,
      };
      expect(executeConditions({ conditions: [eq], value: { a: 5 } })).toBe(
        true,
      );
      expect(executeConditions({ conditions: [eq], value: { a: 6 } })).toBe(
        false,
      );
      expect(executeConditions({ conditions: [neq], value: { a: 6 } })).toBe(
        true,
      );
      expect(executeConditions({ conditions: [neq], value: { a: 5 } })).toBe(
        false,
      );
    });

    it("GREATER_THAN and LESS_THAN", () => {
      const gt: ComparisonCondition = {
        rule: "GREATER_THAN",
        path: "n",
        value: 10,
      };
      const lt: ComparisonCondition = {
        rule: "LESS_THAN",
        path: "n",
        value: 10,
      };
      expect(executeConditions({ conditions: [gt], value: { n: 11 } })).toBe(
        true,
      );
      expect(executeConditions({ conditions: [gt], value: { n: 10 } })).toBe(
        false,
      );
      expect(executeConditions({ conditions: [lt], value: { n: 9 } })).toBe(
        true,
      );
      expect(executeConditions({ conditions: [lt], value: { n: 10 } })).toBe(
        false,
      );
    });

    it("CONTAINS and NOT_CONTAINS only apply to arrays", () => {
      const contains: ComparisonCondition = {
        rule: "CONTAINS",
        path: "tags",
        value: "ts",
      };
      const notContains: ComparisonCondition = {
        rule: "NOT_CONTAINS",
        path: "tags",
        value: "ts",
      };
      expect(
        executeConditions({
          conditions: [contains],
          value: { tags: ["js", "ts"] },
        }),
      ).toBe(true);
      expect(
        executeConditions({ conditions: [contains], value: { tags: ["js"] } }),
      ).toBe(false);
      expect(
        executeConditions({
          conditions: [notContains],
          value: { tags: ["js"] },
        }),
      ).toBe(true);
      // non-array target always fails both CONTAINS and NOT_CONTAINS
      expect(
        executeConditions({ conditions: [contains], value: { tags: "ts" } }),
      ).toBe(false);
      expect(
        executeConditions({ conditions: [notContains], value: { tags: "ts" } }),
      ).toBe(false);
    });

    it("MATCHES uses the value as a regular expression", () => {
      const matches: ComparisonCondition = {
        rule: "MATCHES",
        path: "code",
        value: "^CK-[0-9]+$",
      };
      expect(
        executeConditions({ conditions: [matches], value: { code: "CK-123" } }),
      ).toBe(true);
      expect(
        executeConditions({ conditions: [matches], value: { code: "nope" } }),
      ).toBe(false);
    });

    it("STARTS_WITH and ENDS_WITH", () => {
      const sw: ComparisonCondition = {
        rule: "STARTS_WITH",
        path: "s",
        value: "foo",
      };
      const ew: ComparisonCondition = {
        rule: "ENDS_WITH",
        path: "s",
        value: "bar",
      };
      expect(
        executeConditions({ conditions: [sw], value: { s: "foobar" } }),
      ).toBe(true);
      expect(
        executeConditions({ conditions: [sw], value: { s: "barfoo" } }),
      ).toBe(false);
      expect(
        executeConditions({ conditions: [ew], value: { s: "foobar" } }),
      ).toBe(true);
      expect(
        executeConditions({ conditions: [ew], value: { s: "barfoo" } }),
      ).toBe(false);
    });
  });

  describe("existence rules", () => {
    it("EXISTS passes only for defined non-null values", () => {
      const exists: ExistenceCondition = { rule: "EXISTS", path: "a" };
      expect(executeConditions({ conditions: [exists], value: { a: 0 } })).toBe(
        true,
      );
      expect(
        executeConditions({ conditions: [exists], value: { a: "" } }),
      ).toBe(true);
      expect(
        executeConditions({ conditions: [exists], value: { a: false } }),
      ).toBe(true);
      expect(
        executeConditions({ conditions: [exists], value: { a: null } }),
      ).toBe(false);
      expect(executeConditions({ conditions: [exists], value: {} })).toBe(
        false,
      );
    });

    it("NOT_EXISTS is the inverse of EXISTS", () => {
      const notExists: ExistenceCondition = { rule: "NOT_EXISTS", path: "a" };
      expect(
        executeConditions({ conditions: [notExists], value: { a: 1 } }),
      ).toBe(false);
      expect(
        executeConditions({ conditions: [notExists], value: { a: null } }),
      ).toBe(true);
      expect(executeConditions({ conditions: [notExists], value: {} })).toBe(
        true,
      );
    });
  });

  describe("logical rules", () => {
    it("AND requires all nested conditions to pass", () => {
      const and: LogicalCondition = {
        rule: "AND",
        conditions: [
          { rule: "EQUALS", path: "a", value: 1 },
          { rule: "EQUALS", path: "b", value: 2 },
        ],
      };
      expect(
        executeConditions({ conditions: [and], value: { a: 1, b: 2 } }),
      ).toBe(true);
      expect(
        executeConditions({ conditions: [and], value: { a: 1, b: 3 } }),
      ).toBe(false);
    });

    it("OR passes when any nested condition passes", () => {
      const or: LogicalCondition = {
        rule: "OR",
        conditions: [
          { rule: "EQUALS", path: "a", value: 1 },
          { rule: "EQUALS", path: "b", value: 2 },
        ],
      };
      expect(
        executeConditions({ conditions: [or], value: { a: 9, b: 2 } }),
      ).toBe(true);
      expect(
        executeConditions({ conditions: [or], value: { a: 9, b: 9 } }),
      ).toBe(false);
    });

    it("NOT inverts the AND of nested conditions", () => {
      const notAll: LogicalCondition = {
        rule: "NOT",
        conditions: [
          { rule: "EQUALS", path: "a", value: 1 },
          { rule: "EQUALS", path: "b", value: 2 },
        ],
      };
      // both true → NOT(AND) = false
      expect(
        executeConditions({ conditions: [notAll], value: { a: 1, b: 2 } }),
      ).toBe(false);
      // one false → NOT(AND) = true
      expect(
        executeConditions({ conditions: [notAll], value: { a: 1, b: 3 } }),
      ).toBe(true);
    });
  });

  describe("path resolution", () => {
    it("resolves nested dot paths", () => {
      const cond: ComparisonCondition = {
        rule: "EQUALS",
        path: "user.profile.age",
        value: 30,
      };
      expect(
        executeConditions({
          conditions: [cond],
          value: { user: { profile: { age: 30 } } },
        }),
      ).toBe(true);
      expect(
        executeConditions({
          conditions: [cond],
          value: { user: { profile: { age: 31 } } },
        }),
      ).toBe(false);
    });

    it("returns false for a missing nested path (undefined target)", () => {
      const eq: ComparisonCondition = {
        rule: "EQUALS",
        path: "a.b.c",
        value: 1,
      };
      expect(executeConditions({ conditions: [eq], value: {} })).toBe(false);
    });

    it("uses the whole value when no path is given", () => {
      const eq: ComparisonCondition = { rule: "EQUALS", value: 42 };
      expect(executeConditions({ conditions: [eq], value: 42 })).toBe(true);
      expect(executeConditions({ conditions: [eq], value: 43 })).toBe(false);
    });
  });
});
