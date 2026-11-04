import { describe, expect, it } from "vitest";
import { ɵanySchema } from "@copilotkit/shared";
import type { StandardSchemaV1 } from "@copilotkit/shared";
import type {
  ActivityMessageRendererDef,
  CustomMessageRendererDef,
  ToolCallRendererDef,
} from "../renderer-types";
import type { Message } from "@ag-ui/core";
import {
  ɵdescribeActivityRendererFailure,
  ɵfindActivityRenderer,
  ɵgetCustomMessageRenderProps,
  ɵgetMessageRunStateSnapshot,
  ɵmatchActivityRenderer,
  ɵresolveActivityRenderer,
  ɵresolveCustomMessageRenderContext,
  ɵresolveCustomMessageRenderers,
  ɵresolveToolCallRenderer,
} from "../renderers";
import type { ɵCustomMessageRunSource } from "../renderers";

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

/** An activity query for agent-a's "surface" message. */
function query(content: unknown) {
  return { activityType: "surface", agentId: "agent-a", content };
}

describe("ɵfindActivityRenderer", () => {
  it("picks by the same rules without validating content", () => {
    const renderers = [
      activityRenderer("strict", "surface", { content: doubledCountSchema }),
    ];

    expect(
      ɵfindActivityRenderer(renderers, {
        activityType: "surface",
        agentId: "agent-a",
      })?.render,
    ).toBe("strict");
  });
});

describe("ɵmatchActivityRenderer", () => {
  it("says no renderer matched", () => {
    expect(ɵmatchActivityRenderer([], query({}))).toEqual({
      ok: false,
      reason: "none",
    });
  });

  it("says the content failed the schema, with its issues", () => {
    const strict = activityRenderer("strict", "surface", {
      content: doubledCountSchema,
    });

    const match = ɵmatchActivityRenderer([strict], query({ label: "x" }));

    expect(match.ok).toBe(false);
    expect(match.ok ? undefined : match.reason).toBe("invalid");
  });

  it("says the schema validates asynchronously", () => {
    const async = activityRenderer("async", "surface", {
      content: asyncSchema,
    });

    const match = ɵmatchActivityRenderer([async], query({ count: 1 }));

    expect(match.ok ? undefined : match.reason).toBe("async");
  });

  it("returns the validated content on success", () => {
    const counter = activityRenderer("counter", "surface", {
      content: doubledCountSchema,
    });

    expect(ɵmatchActivityRenderer([counter], query({ count: 2 }))).toEqual({
      ok: true,
      renderer: counter,
      content: 4,
    });
  });
});

describe("ɵdescribeActivityRendererFailure", () => {
  it("explains a rejected or async content, and nothing when no renderer matched", () => {
    const issues = [{ message: "count is required" }];

    expect(
      ɵdescribeActivityRendererFailure("surface", { reason: "none" }),
    ).toBeNull();
    expect(
      ɵdescribeActivityRendererFailure("surface", {
        reason: "invalid",
        issues,
      }),
    ).toEqual({
      message:
        "[CopilotKit] Failed to parse content for activity message 'surface':",
      details: [issues],
    });
    expect(
      ɵdescribeActivityRendererFailure("surface", { reason: "async" })?.message,
    ).toBe(
      "[CopilotKit] Async content validation is not supported for activity message 'surface'.",
    );
  });
});

describe("ɵgetCustomMessageRenderProps", () => {
  const messages: Message[] = [
    { id: "u1", role: "user", content: "hi" },
    { id: "a1", role: "assistant", content: "one" },
    { id: "a2", role: "assistant", content: "two" },
  ];

  /** Runs by message id; counts how often the run state is cloned. */
  function createRunSource(runs: Record<string, string>) {
    let stateReads = 0;
    const source: ɵCustomMessageRunSource = {
      getRunIdForMessage: (_agentId, _threadId, messageId) => runs[messageId],
      getRunIdsForThread: () => [...new Set(Object.values(runs))],
      getStateByRun: (_agentId, _threadId, runId) => {
        stateReads += 1;
        return { runId };
      },
    };
    return { source, stateReads: () => stateReads };
  }

  it("places the message in its run and reads the run state lazily", () => {
    const { source, stateReads } = createRunSource({
      u1: "run-1",
      a1: "run-2",
      a2: "run-2",
    });

    const props = ɵgetCustomMessageRenderProps(source, {
      agentId: "agent-a",
      threadId: "t1",
      agent: { messages },
      message: messages[2]!,
      position: "after",
    });

    expect(props).toMatchObject({
      runId: "run-2",
      messageIndex: 2,
      messageIndexInRun: 1,
      numberOfMessagesInRun: 2,
      agentId: "agent-a",
      position: "after",
    });
    expect(stateReads()).toBe(0);
    expect(props.stateSnapshot).toEqual({ runId: "run-2" });
    expect(props.stateSnapshot).toEqual({ runId: "run-2" });
    expect(stateReads()).toBe(1);
  });

  it("uses a placeholder run when core knows no run for the message", () => {
    const { source } = createRunSource({});

    const props = ɵgetCustomMessageRenderProps(source, {
      agentId: "default",
      threadId: "t1",
      agent: undefined,
      message: messages[1]!,
      position: "before",
    });

    expect(props).toMatchObject({
      runId: "missing-run-id:a1",
      messageIndex: 0,
      messageIndexInRun: 0,
      numberOfMessagesInRun: 1,
      agentId: "default",
    });
    expect(props.stateSnapshot).toBeUndefined();
  });

  it("matches ɵgetMessageRunStateSnapshot for the same message", () => {
    const { source } = createRunSource({ u1: "run-1", a2: "run-2" });
    const params = { agentId: "agent-a", threadId: "t1" };

    // a1 has no run of its own, so both fall back to the latest run.
    for (const message of messages) {
      const props = ɵgetCustomMessageRenderProps(source, {
        ...params,
        agent: { messages },
        message,
        position: "before",
      });
      expect(
        ɵgetMessageRunStateSnapshot(source, {
          ...params,
          messageId: message.id,
        }),
      ).toEqual(props.stateSnapshot);
    }
  });
});

describe("ɵgetMessageRunStateSnapshot", () => {
  it("returns the state of the run that produced the message", () => {
    const source: ɵCustomMessageRunSource = {
      getRunIdForMessage: (_a, _t, messageId) =>
        messageId === "m1" ? "run-1" : undefined,
      getRunIdsForThread: () => ["run-1", "run-2"],
      getStateByRun: (_a, _t, runId) => ({ runId }),
    };
    const params = { agentId: "agent-a", threadId: "t1" };

    expect(
      ɵgetMessageRunStateSnapshot(source, { ...params, messageId: "m1" }),
    ).toEqual({ runId: "run-1" });
    expect(
      ɵgetMessageRunStateSnapshot(source, { ...params, messageId: "m9" }),
    ).toEqual({ runId: "run-2" });
  });

  it("returns undefined when the thread has no run", () => {
    let stateReads = 0;
    const source: ɵCustomMessageRunSource = {
      getRunIdForMessage: () => undefined,
      getRunIdsForThread: () => [],
      getStateByRun: () => {
        stateReads += 1;
        return {};
      },
    };

    expect(
      ɵgetMessageRunStateSnapshot(source, {
        agentId: "agent-a",
        threadId: "t1",
        messageId: "m1",
      }),
    ).toBeUndefined();
    expect(stateReads).toBe(0);
  });
});

describe("ɵresolveCustomMessageRenderContext", () => {
  it("uses the default agent for a chat with no agent id", () => {
    const renderers: CustomMessageRendererDef<string>[] = [
      { render: "for-default", agentId: "default" },
      { render: "for-other", agentId: "other" },
      { render: "global" },
    ];

    const context = ɵresolveCustomMessageRenderContext(renderers, "");

    expect(context.agentId).toBe("default");
    expect(context.renderers.map(({ render }) => render)).toEqual([
      "for-default",
      "global",
    ]);
  });
});
