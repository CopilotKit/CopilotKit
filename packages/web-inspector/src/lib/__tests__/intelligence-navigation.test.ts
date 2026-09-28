import { expect, test } from "vitest";
import { INSPECTOR_MENU_KEYS, isInspectorMenuKey } from "../inspector-nav.js";

test("adds analytics and governance while preserving all existing Inspector leaves", () => {
  expect(INSPECTOR_MENU_KEYS).toEqual(
    expect.arrayContaining([
      "home",
      "whats-new",
      "playground",
      "threads",
      "memories",
      "agents",
      "ag-ui-events",
      "frontend-tools",
      "capabilities",
      "agent-context",
    ]),
  );
  expect(isInspectorMenuKey("analytics")).toBe(true);
  expect(isInspectorMenuKey("governance")).toBe(true);
});
