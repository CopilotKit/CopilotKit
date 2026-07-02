import { test, expect } from "vitest";
import { parseCommand } from "./args";
test("parses /triage", () =>
  expect(parseCommand("/triage")).toEqual({ command: "triage", deep: false }));
test("parses /triage --deep", () =>
  expect(parseCommand("  /triage --deep please")).toEqual({
    command: "triage",
    deep: true,
  }));
test("parses /fix", () =>
  expect(parseCommand("/fix it")).toEqual({ command: "fix", deep: false }));
test("ignores mid-comment mention", () =>
  expect(parseCommand("I think /triage would help")).toBeNull());
test("ignores unrelated", () => expect(parseCommand("thanks!")).toBeNull());
