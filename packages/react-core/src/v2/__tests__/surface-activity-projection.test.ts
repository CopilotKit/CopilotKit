import { describe, expect, it } from "vitest";
import type { ActivityMessage, Message } from "@ag-ui/core";
import { projectSurfaceActivities } from "../a2ui/surface-activity-projection";

const create = (surfaceId: string) => ({
  version: "v0.9",
  createSurface: { surfaceId, catalogId: "test" },
});
const update = (surfaceId: string, value = 1) => ({
  version: "v0.9",
  updateDataModel: { surfaceId, path: "/value", value },
});
const activity = (
  id: string,
  operations: Record<string, unknown>[],
): ActivityMessage => ({
  id,
  role: "activity",
  activityType: "a2ui-surface",
  content: { a2ui_operations: operations },
});

describe("surface activity projection", () => {
  it("routes updates to distinct preceding creates and preserves canonical messages", () => {
    const a = create("a"),
      b = create("b"),
      ua = update("a"),
      ub = update("b");
    const messages: Message[] = [
      activity("a", [a]),
      activity("b", [b]),
      {
        id: "result",
        role: "tool",
        toolCallId: "update",
        content: JSON.stringify({ a2ui_operations: [ua, ub] }),
      },
      activity("update", [ua, ub]),
    ];
    const before = JSON.stringify(messages);
    const projection = projectSurfaceActivities(messages);
    expect(projection.get("a")).toEqual([a, ua]);
    expect(projection.get("b")).toEqual([b, ub]);
    expect(projection.get("update")).toEqual([]);
    expect(JSON.stringify(messages)).toBe(before);
  });
  it("keeps independent same-ID creations and ambiguous updates separate", () => {
    const a = create("same"),
      b = create("same"),
      u = update("same");
    const projection = projectSurfaceActivities([
      activity("a", [a]),
      activity("b", [b]),
      activity("u", [u]),
    ]);
    expect([...projection.values()]).toEqual([[a], [b], [u]]);
  });
  it("keeps an orphan update in its own activity, even before a later create", () => {
    const u = update("later"),
      c = create("later");
    expect([
      ...projectSurfaceActivities([
        activity("u", [u]),
        activity("c", [c]),
      ]).values(),
    ]).toEqual([[u], [c]]);
  });
  it("does not carry ownership between histories", () => {
    projectSurfaceActivities([activity("old-thread", [create("same")])]);
    const u = update("same");
    expect(
      projectSurfaceActivities([activity("new-thread", [u])]).get("new-thread"),
    ).toEqual([u]);
  });
  it("handles mixed updates and new surfaces without hiding the new surface", () => {
    const c = create("a"),
      u = update("a"),
      fresh = create("b"),
      ub = update("b");
    const projection = projectSurfaceActivities([
      activity("a", [c]),
      activity("mixed", [u, fresh, ub]),
    ]);
    expect(projection.get("a")).toEqual([c, u]);
    expect(projection.get("mixed")).toEqual([fresh, ub]);
  });
  it("ends ownership on delete and allows an independent new lifetime", () => {
    const c = create("a"),
      del = { version: "v0.9", deleteSurface: { surfaceId: "a" } },
      fresh = create("a"),
      u = update("a");
    const projection = projectSurfaceActivities([
      activity("old", [c]),
      activity("delete", [del]),
      activity("new", [fresh]),
      activity("u", [u]),
    ]);
    expect(projection.get("old")).toEqual([c, del]);
    expect(projection.get("delete")).toEqual([]);
    expect(projection.get("new")).toEqual([fresh, u]);
  });
  it("ignores lifecycle content and unrelated activity types", () => {
    const c = create("a"),
      u = update("a");
    const projection = projectSurfaceActivities([
      activity("owner", [c]),
      {
        id: "building",
        role: "activity",
        activityType: "a2ui-surface",
        content: { status: "building" },
      },
      { ...activity("unrelated", [u]), activityType: "other" },
    ]);
    expect([...projection.entries()]).toEqual([["owner", [c]]]);
  });
});
