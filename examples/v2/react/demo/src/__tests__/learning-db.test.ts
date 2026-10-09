import { describe, expect, it } from "vitest";
import {
  insertBatch,
  listEvents,
  openLearningDb,
  parseBatch,
} from "../lib/learning-db";

function createBody() {
  return {
    trajectoryId: "traj-1",
    learningContainerIds: ["container-1"],
    dropped: 0,
    events: [
      {
        type: "CUSTOM",
        name: "click",
        timestamp: 1000,
        value: { seq: 2, threadId: "thread-1", route: "/deals/:id" },
      },
      {
        type: "CUSTOM",
        name: "page",
        timestamp: 900,
        value: { seq: 1, route: "/learning" },
      },
    ],
  };
}

describe("learning db", () => {
  it("stores a batch and lists events in capture order", () => {
    const db = openLearningDb(":memory:");
    const batch = parseBatch(createBody());
    if (batch === null) throw new Error("expected a valid batch");

    expect(insertBatch(db, batch)).toBe(2);
    expect(listEvents(db)).toEqual([
      {
        id: 2,
        trajectoryId: "traj-1",
        seq: 1,
        name: "page",
        threadId: null,
        timestamp: 900,
        value: { seq: 1, route: "/learning" },
      },
      {
        id: 1,
        trajectoryId: "traj-1",
        seq: 2,
        name: "click",
        threadId: "thread-1",
        timestamp: 1000,
        value: { seq: 2, threadId: "thread-1", route: "/deals/:id" },
      },
    ]);
  });

  it("rejects a body that is not a batch", () => {
    expect(parseBatch({ trajectoryId: 7, events: [] })).toBeNull();
    expect(
      parseBatch({ trajectoryId: "t", events: [{ name: "click" }] }),
    ).toBeNull();
  });
});
