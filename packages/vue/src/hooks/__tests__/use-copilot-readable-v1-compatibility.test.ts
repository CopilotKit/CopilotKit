import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRef, reactive, ref } from "vue";

vi.mock("../../v2/providers/useCopilotKit", () => ({
  useCopilotKit: vi.fn(),
}));

import { useCopilotKit } from "../../v2/providers/useCopilotKit";
import { useCopilotReadable } from "../use-copilot-readable";

const useCopilotKitMock = vi.mocked(useCopilotKit);

type ContextItem = { description: string; value: unknown };

function createCore() {
  const context: Record<string, ContextItem> = {};
  let nextId = 0;
  return {
    context,
    addContext: vi.fn((item: ContextItem) => {
      const id = `context-${++nextId}`;
      context[id] = item;
      return id;
    }),
    removeContext: vi.fn((id: string) => {
      delete context[id];
    }),
  };
}

let core: ReturnType<typeof createCore>;

beforeEach(() => {
  core = createCore();
  useCopilotKitMock.mockReturnValue({ copilotkit: ref(core) } as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useCopilotReadable v1 compatibility", () => {
  it("returns a Vue Ref and calls convert with value only", () => {
    const value = { name: "Ada" };
    const convert = vi.fn((...args: [unknown, unknown]) =>
      JSON.stringify(args[0]),
    );

    const id = useCopilotReadable({
      description: "Customer",
      value,
      convert,
    });

    expect(isRef(id)).toBe(true);
    expect(convert).toHaveBeenCalledExactlyOnceWith(value);
    expect(convert.mock.calls[0]).toHaveLength(1);
    expect(convert.mock.calls[0]?.[0]).toBe(value);
    expect(convert.mock.calls[0]?.[1]).toBeUndefined();
    expect(core.addContext).toHaveBeenCalledWith({
      description: "Customer",
      value: JSON.stringify(value),
    });
  });

  it("reuses a duplicate context entry", () => {
    core.context.existing = { description: "Customer", value: "Ada" };

    const id = useCopilotReadable({
      description: "Customer",
      value: "Ada",
    });

    expect(id.value).toBe("existing");
    expect(core.addContext).not.toHaveBeenCalled();
  });

  it("updates context on reactive value changes and removes the prior entry", () => {
    const options = reactive({
      description: "Count",
      value: 1,
    });

    useCopilotReadable(options);
    expect(core.addContext).toHaveBeenCalledTimes(1);

    options.value = 2;

    expect(core.removeContext).toHaveBeenCalledWith("context-1");
    expect(core.addContext).toHaveBeenCalledTimes(2);
    expect(core.addContext).toHaveBeenLastCalledWith({
      description: "Count",
      value: "2",
    });
  });

  it("does not watch availability as an extra dependency", () => {
    const options = reactive({
      description: "Status",
      value: "ready",
      available: "enabled" as "enabled" | "disabled",
    });

    useCopilotReadable(options);
    options.available = "disabled";

    expect(core.removeContext).not.toHaveBeenCalled();
    expect(core.addContext).toHaveBeenCalledTimes(1);
  });

  it("accepts but does not consume dependency sources", () => {
    const dependency = ref(0);

    useCopilotReadable(
      {
        description: "Status",
        value: "ready",
      },
      [dependency],
    );
    dependency.value++;

    expect(core.removeContext).not.toHaveBeenCalled();
    expect(core.addContext).toHaveBeenCalledTimes(1);
  });

  it("propagates conversion errors", () => {
    const error = new Error("cannot convert");

    expect(() =>
      useCopilotReadable({
        description: "Broken",
        value: {},
        convert: () => {
          throw error;
        },
      }),
    ).toThrow(error);
  });

  it("accepts legacy hierarchy fields without consuming them", () => {
    useCopilotReadable({
      description: "Child",
      value: "value",
      parentId: "parent",
      categories: ["category"],
    });

    expect(core.addContext).toHaveBeenCalledWith({
      description: "Child",
      value: '"value"',
    });
  });

  it("does not observe mutation inside an unreactive plain object", () => {
    const value = { ready: false };
    useCopilotReadable({ description: "State", value });

    value.ready = true;

    expect(core.addContext).toHaveBeenCalledTimes(1);
    expect(core.removeContext).not.toHaveBeenCalled();
  });
});
