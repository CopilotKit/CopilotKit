import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_AGENT_CONTEXT_WARN_THRESHOLD,
  computeAssembledAgentContextSize,
  getAgentContextWarnThreshold,
  resetAgentContextWarnState,
  warnIfAssembledAgentContextOversized,
} from "../agent-context-size";

/** Rebuilds the exact fragments each assembly path emits, used to assert the
 * size measurement matches the actual assembled prompt. */
function builtInFragments(
  context: { description: string; value: string }[],
  state: unknown,
): number {
  let size = context.length ? "\n## Context from the application\n".length : 0;
  for (const c of context) {
    size += `${c.description}:\n${c.value}\n`.length;
  }
  if (
    state !== undefined &&
    state !== null &&
    typeof state === "object" &&
    Object.keys(state).length > 0
  ) {
    size += (
      "\n## Application State\n" +
      "This is state from the application that you can edit by calling AGUISendStateSnapshot or AGUISendStateDelta.\n" +
      `\`\`\`json\n${JSON.stringify(state, null, 2)}\n\`\`\`\n`
    ).length;
  }
  return size;
}

function tanstackFragments(
  context: { description: string; value: string }[],
  state: unknown,
): number {
  let size = 0;
  for (let i = 0; i < context.length; i++) {
    size += `${context[i]!.description}:\n${context[i]!.value}`.length;
    if (i < context.length - 1) size += 1;
  }
  const hasState =
    state !== undefined &&
    state !== null &&
    typeof state === "object" &&
    Object.keys(state).length > 0;
  if (context.length > 0 && hasState) size += 1; // the `\n` separator before state
  if (hasState) {
    size +=
      `Application State:\n\`\`\`json\n${JSON.stringify(state, null, 2)}\n\`\`\``
        .length;
  }
  return size;
}

describe("computeAssembledAgentContextSize", () => {
  it("matches the exact built-in fragments", () => {
    const context = [{ description: "page", value: "home" }];
    const state = { draft: "hello world" };
    const serialized = String(JSON.stringify(state, null, 2));
    expect(
      computeAssembledAgentContextSize(context, serialized, "builtIn"),
    ).toBe(builtInFragments(context, state));
  });

  it("matches the exact tanstack fragments (no trailing newline on context)", () => {
    const context = [
      { description: "page", value: "home" },
      { description: "row", value: "42" },
    ];
    const state = { draft: "hello world" };
    const serialized = String(JSON.stringify(state, null, 2));
    expect(
      computeAssembledAgentContextSize(context, serialized, "tanstack"),
    ).toBe(tanstackFragments(context, state));
  });

  it("returns 0 when context is empty and state is empty or null", () => {
    expect(
      computeAssembledAgentContextSize(undefined, undefined, "builtIn"),
    ).toBe(0);
    expect(computeAssembledAgentContextSize([], undefined, "tanstack")).toBe(0);
  });

  it("does not count the built-in header or tanstack separator for an empty context", () => {
    // built-in adds the header only when context is non-empty.
    expect(computeAssembledAgentContextSize([], undefined, "builtIn")).toBe(0);
    // tanstack adds no context→state separator when there is no context entry.
    const serialized = String(JSON.stringify({ draft: "x" }, null, 2));
    expect(computeAssembledAgentContextSize([], serialized, "tanstack")).toBe(
      `Application State:\n\`\`\`json\n${serialized}\n\`\`\``.length,
    );
  });

  it("counts a state whose toJSON() returns undefined as the literal 'undefined'", () => {
    const weird = { toJSON: () => undefined };
    const serialized = String(JSON.stringify(weird, null, 2));
    const expected = `Application State:\n\`\`\`json\n${serialized}\n\`\`\``
      .length;
    expect(
      computeAssembledAgentContextSize(undefined, serialized, "tanstack"),
    ).toBe(expected);
  });

  it("measures the built-in context header once, not per entry", () => {
    const context = [
      { description: "a", value: "1" },
      { description: "b", value: "2" },
    ];
    const builtIn = computeAssembledAgentContextSize(
      context,
      undefined,
      "builtIn",
    );
    const tanstack = computeAssembledAgentContextSize(
      context,
      undefined,
      "tanstack",
    );
    // built-in adds the header + trailing newline; tanstack has no header/joiner.
    expect(builtIn).toBeGreaterThan(tanstack);
    expect(builtIn - tanstack).toBe(
      "\n## Context from the application\n".length + 1,
    );
  });
});

describe("warnIfAssembledAgentContextOversized", () => {
  const originalThreshold = process.env.COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD;

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    resetAgentContextWarnState();
    delete process.env.COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalThreshold === undefined) {
      delete process.env.COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD;
    } else {
      process.env.COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD = originalThreshold;
    }
  });

  it("warns as soon as the assembled built-in fragments exceed the threshold", () => {
    const value = "x".repeat(DEFAULT_AGENT_CONTEXT_WARN_THRESHOLD);
    warnIfAssembledAgentContextOversized(
      [{ description: "big", value }],
      undefined,
      "builtIn",
    );
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("warns as soon as the assembled tanstack fragments exceed the threshold", () => {
    const value = "x".repeat(DEFAULT_AGENT_CONTEXT_WARN_THRESHOLD);
    warnIfAssembledAgentContextOversized(
      [{ description: "big", value }],
      undefined,
      "tanstack",
    );
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("warns only once per call-site variant, even across repeated turns", () => {
    const value = "x".repeat(DEFAULT_AGENT_CONTEXT_WARN_THRESHOLD);
    const input = [{ description: "big", value }];
    warnIfAssembledAgentContextOversized(input, undefined, "builtIn");
    warnIfAssembledAgentContextOversized(input, undefined, "builtIn");
    expect(console.warn).toHaveBeenCalledTimes(1);

    vi.mocked(console.warn).mockClear();
    warnIfAssembledAgentContextOversized(input, undefined, "tanstack");
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("does not mutate or drop the supplied data", () => {
    const context = [
      {
        description: "big",
        value: "x".repeat(DEFAULT_AGENT_CONTEXT_WARN_THRESHOLD),
      },
    ];
    const state = { draft: "payload" };
    warnIfAssembledAgentContextOversized(
      context,
      String(JSON.stringify(state, null, 2)),
      "builtIn",
    );

    expect(context[0]!.value).toBe(
      "x".repeat(DEFAULT_AGENT_CONTEXT_WARN_THRESHOLD),
    );
    expect(state.draft).toBe("payload");
  });

  it("does not warn when the assembled fragments are within the threshold", () => {
    warnIfAssembledAgentContextOversized(
      [{ description: "page", value: "home" }],
      undefined,
      "builtIn",
    );
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("honours an env-overridable threshold and disables with -1", () => {
    process.env.COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD = "10";
    warnIfAssembledAgentContextOversized(
      [{ description: "x", value: "y".repeat(50) }],
      undefined,
      "tanstack",
    );
    expect(console.warn).toHaveBeenCalledTimes(1);

    vi.mocked(console.warn).mockClear();
    process.env.COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD = "-1";
    warnIfAssembledAgentContextOversized(
      [{ description: "x", value: "y".repeat(50) }],
      undefined,
      "tanstack",
    );
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe("getAgentContextWarnThreshold", () => {
  const originalThreshold = process.env.COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD;

  afterEach(() => {
    if (originalThreshold === undefined) {
      delete process.env.COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD;
    } else {
      process.env.COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD = originalThreshold;
    }
  });

  it("uses the default when the env value is unset, empty, or whitespace", () => {
    delete process.env.COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD;
    expect(getAgentContextWarnThreshold()).toBe(
      DEFAULT_AGENT_CONTEXT_WARN_THRESHOLD,
    );
    process.env.COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD = "";
    expect(getAgentContextWarnThreshold()).toBe(
      DEFAULT_AGENT_CONTEXT_WARN_THRESHOLD,
    );
    process.env.COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD = "  ";
    expect(getAgentContextWarnThreshold()).toBe(
      DEFAULT_AGENT_CONTEXT_WARN_THRESHOLD,
    );
  });

  it("rejects partially parsed values and falls back to the default", () => {
    for (const bad of ["100abc", "1.5", "-1oops", "abc", "12px", "-2", "--1"]) {
      process.env.COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD = bad;
      expect(getAgentContextWarnThreshold()).toBe(
        DEFAULT_AGENT_CONTEXT_WARN_THRESHOLD,
      );
    }
  });

  it("accepts a complete integer and a disable sentinel", () => {
    process.env.COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD = "10";
    expect(getAgentContextWarnThreshold()).toBe(10);
    process.env.COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD = "0";
    expect(getAgentContextWarnThreshold()).toBe(0);
    process.env.COPILOTKIT_AGENT_CONTEXT_WARN_THRESHOLD = "-1";
    expect(getAgentContextWarnThreshold()).toBe(-1);
  });
});
