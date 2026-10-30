import { describe, expect, it } from "vitest";
import { ɵanySchema } from "@copilotkit/shared";
import type { StandardSchemaV1 } from "@copilotkit/shared";
import type {
  ActivityMessageRendererDef,
  CustomMessageRendererDef,
  ToolCallRendererDef,
} from "../renderer-types";
import {
  ɵresolveActivityRenderer,
  ɵresolveCustomMessageRenderers,
  ɵresolveToolCallRenderer,
} from "../renderers";

/** `render` is a label, so a test can say which renderer won. */
function toolRenderer(
  render: string,
  name: string,
  agentId?: string,
): ToolCallRendererDef<unknown, string> {
  return { name, agentId, render };
}

function activityRenderer(
  render: string,
  activityType: string,
  overrides: Partial<ActivityMessageRendererDef<unknown, string>> = {},
): ActivityMessageRendererDef<unknown, string> {
  return { activityType, content: ɵanySchema, render, ...overrides };
}

function customRenderer(
  render: string,
  agentId?: string,
): CustomMessageRendererDef<string> {
  return { agentId, render };
}

/** A schema that reads `{ count: number }` and returns `count` doubled. */
const doubledCountSchema: StandardSchemaV1<unknown, number> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) => {
      const count =
        typeof value === "object" && value !== null && "count" in value
          ? value.count
          : undefined;
      if (typeof count !== "number") {
        return { issues: [{ message: "count missing" }] };
      }
      return { value: count * 2 };
    },
  },
};

const asyncSchema: StandardSchemaV1<unknown, unknown> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: async (value) => ({ value }),
  },
};

describe("ɵresolveToolCallRenderer", () => {
  it.each([
    {
      rule: "agent-scoped beats unscoped registered before it",
      renderers: [
        toolRenderer("unscoped", "search"),
        toolRenderer("mine", "search", "agent-a"),
      ],
      expected: "mine",
    },
    {
      rule: "unscoped beats another agent's renderer registered before it",
      renderers: [
        toolRenderer("other", "search", "agent-b"),
        toolRenderer("unscoped", "search"),
      ],
      expected: "unscoped",
    },
    {
      rule: "another agent's renderer is the fallback for a named tool",
      renderers: [
        toolRenderer("other-b", "search", "agent-b"),
        toolRenderer("other-c", "search", "agent-c"),
      ],
      expected: "other-b",
    },
    {
      rule: "another agent's named renderer beats a wildcard",
      renderers: [
        toolRenderer("wildcard", "*"),
        toolRenderer("other", "search", "agent-b"),
      ],
      expected: "other",
    },
    {
      rule: "a wildcard from another agent applies",
      renderers: [
        toolRenderer("other-tool", "fetch"),
        toolRenderer("wildcard-b", "*", "agent-b"),
        toolRenderer("wildcard", "*"),
      ],
      expected: "wildcard-b",
    },
    {
      rule: "an empty agentId counts as unscoped",
      renderers: [
        toolRenderer("other", "search", "agent-b"),
        toolRenderer("empty", "search", ""),
      ],
      expected: "empty",
    },
  ])("$rule", ({ renderers, expected }) => {
    expect(
      ɵresolveToolCallRenderer(renderers, "search", "agent-a")?.render,
    ).toBe(expected);
  });

  it("matches unscoped before other agents when there is no current agent", () => {
    const renderers = [
      toolRenderer("other", "search", "agent-b"),
      toolRenderer("unscoped", "search"),
    ];

    expect(
      ɵresolveToolCallRenderer(renderers, "search", undefined)?.render,
    ).toBe("unscoped");
  });

  it("returns null when no named or wildcard renderer exists", () => {
    const renderers = [toolRenderer("other-tool", "fetch", "agent-a")];

    expect(ɵresolveToolCallRenderer(renderers, "search", "agent-a")).toBeNull();
  });
});

describe("ɵresolveActivityRenderer", () => {
  function resolve(
    renderers: ActivityMessageRendererDef<unknown, string>[],
    agentId?: string,
    content: unknown = { count: 1 },
  ) {
    return ɵresolveActivityRenderer(renderers, {
      activityType: "surface",
      agentId,
      content,
    });
  }

  it.each([
    {
      rule: "agent-scoped beats unscoped registered before it",
      renderers: [
        activityRenderer("unscoped", "surface"),
        activityRenderer("mine", "surface", { agentId: "agent-a" }),
      ],
      agentId: "agent-a",
      expected: "mine",
    },
    {
      rule: "unscoped applies when the agent has no scoped renderer",
      renderers: [
        activityRenderer("other", "surface", { agentId: "agent-b" }),
        activityRenderer("unscoped", "surface"),
      ],
      agentId: "agent-a",
      expected: "unscoped",
    },
    {
      rule: "another agent's renderer for the type is skipped for the wildcard",
      renderers: [
        activityRenderer("other", "surface", { agentId: "agent-b" }),
        activityRenderer("wildcard", "*"),
      ],
      agentId: "agent-a",
      expected: "wildcard",
    },
    {
      rule: "a wildcard from another agent applies",
      renderers: [
        activityRenderer("other-type", "progress"),
        activityRenderer("wildcard-b", "*", { agentId: "agent-b" }),
      ],
      agentId: "agent-a",
      expected: "wildcard-b",
    },
    {
      rule: "scoped renderers are skipped when there is no current agent",
      renderers: [
        activityRenderer("mine", "surface", { agentId: "agent-a" }),
        activityRenderer("unscoped", "surface"),
      ],
      agentId: undefined,
      expected: "unscoped",
    },
  ])("$rule", ({ renderers, agentId, expected }) => {
    expect(resolve(renderers, agentId)?.renderer.render).toBe(expected);
  });

  it("returns null when no renderer matches", () => {
    const renderers = [
      activityRenderer("other", "surface", { agentId: "agent-b" }),
      activityRenderer("other-type", "progress"),
    ];

    expect(resolve(renderers, "agent-a")).toBeNull();
  });

  it("returns the validated value, not the raw content", () => {
    const renderers = [
      activityRenderer("counter", "surface", { content: doubledCountSchema }),
    ];

    expect(resolve(renderers, "agent-a", { count: 3 })?.content).toBe(6);
  });

  it("returns null when validation fails, without trying the next renderer", () => {
    const renderers = [
      activityRenderer("strict", "surface", { content: doubledCountSchema }),
      activityRenderer("wildcard", "*"),
    ];

    expect(resolve(renderers, "agent-a", { label: "no count" })).toBeNull();
  });

  it("returns null when the schema validates asynchronously", () => {
    const renderers = [
      activityRenderer("async", "surface", { content: asyncSchema }),
    ];

    expect(resolve(renderers, "agent-a")).toBeNull();
  });
});

describe("ɵresolveCustomMessageRenderers", () => {
  it("puts agent-scoped renderers first and keeps registration order", () => {
    const renderers = [
      customRenderer("unscoped-1"),
      customRenderer("mine-1", "agent-a"),
      customRenderer("other", "agent-b"),
      customRenderer("unscoped-2"),
      customRenderer("mine-2", "agent-a"),
    ];

    const resolved = ɵresolveCustomMessageRenderers(renderers, "agent-a");

    expect(resolved.map((renderer) => renderer.render)).toEqual([
      "mine-1",
      "mine-2",
      "unscoped-1",
      "unscoped-2",
    ]);
  });

  it("returns an empty list when only other agents have renderers", () => {
    const renderers = [customRenderer("other", "agent-b")];

    expect(ɵresolveCustomMessageRenderers(renderers, "agent-a")).toEqual([]);
  });
});
