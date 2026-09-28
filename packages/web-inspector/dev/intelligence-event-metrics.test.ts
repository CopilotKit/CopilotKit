import { expect, test } from "vitest";
import { intelligenceFixture } from "./intelligence-state-lab.js";

const period = {
  from: "2026-09-20T00:00:00.000Z",
  to: "2026-09-27T00:00:00.000Z",
};

test.each(["message.user", "message.assistant", "learning.skill_loaded"])(
  "event fixture serves the exact %s record",
  (type) => {
    expect(
      intelligenceFixture({
        method: "GET",
        path: "/api/v1/governance/events",
        query: { ...period, type },
      }).body,
    ).toMatchObject({ data: [{ type }] });
  },
);

test.each([
  { agentId: "support", total: 1 },
  { agentId: "billing", total: 0 },
])("Ask event counts respect $agentId", ({ agentId, total }) => {
  expect(
    intelligenceFixture({
      method: "POST",
      path: "/ask",
      body: { ...period, agentId, question: "Messages and Skill loads" },
    }).body,
  ).toMatchObject({
    results: [
      { data: { metric: "user_messages", total } },
      { data: { metric: "assistant_messages", total } },
      { data: { metric: "skill_loads", total } },
    ],
  });
});
