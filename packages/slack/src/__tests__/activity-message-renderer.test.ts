import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  defineActivityMessageRenderer,
  selectActivityRenderer,
} from "../activity-message-renderer.js";

describe("defineActivityMessageRenderer", () => {
  it("returns the renderer back, with inferred content generic", () => {
    const r = defineActivityMessageRenderer({
      activityType: "demo",
      content: z.object({ hello: z.string() }),
      render: ({ content }) => [
        { type: "section", text: { type: "mrkdwn", text: content.hello } },
      ],
    });
    const blocks = r.render({
      activityType: "demo",
      content: { hello: "world" },
      message: {
        id: "m1",
        role: "activity",
        activityType: "demo",
        content: { hello: "world" },
      },
    });
    expect(blocks).toHaveLength(1);
  });
});

describe("selectActivityRenderer precedence", () => {
  const exact = {
    activityType: "thing",
    render: () => [],
  };
  const exactAgentA = {
    activityType: "thing",
    agentId: "A",
    render: () => [],
  };
  const wildcard = { activityType: "*", render: () => [] };
  const wildcardAgentA = {
    activityType: "*",
    agentId: "A",
    render: () => [],
  };

  it("exact + agent beats exact-unscoped", () => {
    const r = selectActivityRenderer([exact, exactAgentA], "thing", "A");
    expect(r).toBe(exactAgentA);
  });

  it("exact-unscoped wins when agent doesn't match a scoped exact", () => {
    const r = selectActivityRenderer([exact, exactAgentA], "thing", "B");
    expect(r).toBe(exact);
  });

  it("exact wins over wildcard regardless of agent", () => {
    const r = selectActivityRenderer([wildcard, exact], "thing");
    expect(r).toBe(exact);
  });

  it("wildcard with agent beats wildcard-unscoped", () => {
    const r = selectActivityRenderer(
      [wildcard, wildcardAgentA],
      "anything",
      "A",
    );
    expect(r).toBe(wildcardAgentA);
  });

  it("returns undefined when nothing matches", () => {
    const r = selectActivityRenderer([exact], "no-match");
    expect(r).toBeUndefined();
  });

  it("returns undefined for empty list", () => {
    expect(selectActivityRenderer([], "anything")).toBeUndefined();
  });
});
