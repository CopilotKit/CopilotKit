import { expect, test } from "vitest";
import { intelligenceFixture } from "./intelligence-state-lab.js";

test.each(["userCapture", "agentCapture"])(
  "a missing %s fixture filter does not return captured identities",
  (field) => {
    expect(
      intelligenceFixture({
        method: "GET",
        path: "/api/v1/runs",
        query: {
          from: "2026-09-20T00:00:00.000Z",
          to: "2026-09-27T00:00:00.000Z",
          [field]: "missing",
        },
      }).body,
    ).toMatchObject({ data: [] });
  },
);
