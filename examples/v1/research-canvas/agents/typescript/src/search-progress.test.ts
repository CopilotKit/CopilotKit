import { expect, test } from "vitest";
import { createSearchProgress } from "./search-progress";

test("repeated searches complete the current query progress", () => {
  const logs = [{ message: "Search for CopilotKit", done: true }];
  const progress = createSearchProgress(logs, ["CopilotKit"]);

  expect(logs).toEqual([
    { message: "Search for CopilotKit", done: true },
    { message: "Search for CopilotKit", done: false },
  ]);

  progress.complete(0);

  expect(logs).toEqual([
    { message: "Search for CopilotKit", done: true },
    { message: "Search for CopilotKit", done: true },
  ]);
});
