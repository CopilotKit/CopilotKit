import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { useCopilotKit } from "../../providers/useCopilotKit";
import { useAgentContext } from "../use-agent-context";
import { mountWithProvider } from "../../__tests__/utils/mount";

function getContextEntries(
  core: ReturnType<typeof useCopilotKit>["copilotkit"]["value"],
) {
  return Object.values(core.context ?? {});
}

describe("useAgentContext", () => {
  beforeEach(() => {
    console.warn = vi.fn();
    console.error = vi.fn();
  });

  it("adds context on mount and removes on unmount", () => {
    let core:
      | ReturnType<typeof useCopilotKit>["copilotkit"]["value"]
      | undefined;

    const Child = defineComponent({
      setup() {
        useAgentContext({
          description: "Test context",
          value: { key: "value" },
        });
        return () => h("div", "child");
      },
    });

    const Probe = defineComponent({
      setup() {
        const { copilotkit } = useCopilotKit();
        core = copilotkit.value;
        return () => null;
      },
    });

    const { wrapper } = mountWithProvider(() => h("div", [h(Child), h(Probe)]));
    expect(getContextEntries(core!)).toHaveLength(1);

    wrapper.unmount();
    expect(getContextEntries(core!)).toHaveLength(0);
  });

  it("removes context when conditionally unmounted", async () => {
    let core:
      | ReturnType<typeof useCopilotKit>["copilotkit"]["value"]
      | undefined;

    const ContextUser = defineComponent({
      setup() {
        useAgentContext({ description: "conditional", value: "value" });
        return () => h("div", "context-user");
      },
    });

    const Parent = defineComponent({
      setup() {
        const shown = ref(true);
        const { copilotkit } = useCopilotKit();
        core = copilotkit.value;
        return () =>
          h("div", [
            h(
              "button",
              {
                "data-testid": "toggle",
                onClick: () => (shown.value = !shown.value),
              },
              "toggle",
            ),
            shown.value ? h(ContextUser) : null,
          ]);
      },
    });

    const { wrapper } = mountWithProvider(() => h(Parent));
    expect(getContextEntries(core!)).toHaveLength(1);

    await wrapper.find("[data-testid=toggle]").trigger("click");
    await nextTick();

    expect(getContextEntries(core!)).toHaveLength(0);
  });

  it("does not duplicate context on parent re-render with stable inputs", async () => {
    let core:
      | ReturnType<typeof useCopilotKit>["copilotkit"]["value"]
      | undefined;

    const Child = defineComponent({
      setup() {
        useAgentContext({
          description: "Stable context",
          value: "stable value",
        });
        return () => h("div", "child");
      },
    });

    const Parent = defineComponent({
      setup() {
        const counter = ref(0);
        const { copilotkit } = useCopilotKit();
        core = copilotkit.value;
        return () =>
          h("div", [
            h(
              "button",
              {
                "data-testid": "increment",
                onClick: () => (counter.value += 1),
              },
              String(counter.value),
            ),
            h(Child),
          ]);
      },
    });

    const { wrapper } = mountWithProvider(() => h(Parent));
    expect(getContextEntries(core!)).toHaveLength(1);

    await wrapper.find("[data-testid=increment]").trigger("click");
    await wrapper.find("[data-testid=increment]").trigger("click");
    await nextTick();

    expect(getContextEntries(core!)).toHaveLength(1);
  });

  it("re-adds context when description changes", async () => {
    let core:
      | ReturnType<typeof useCopilotKit>["copilotkit"]["value"]
      | undefined;
    const description = ref("first");

    const Child = defineComponent({
      setup() {
        useAgentContext({ description, value: "same" });
        return () => h("div", "child");
      },
    });

    const Parent = defineComponent({
      setup() {
        const { copilotkit } = useCopilotKit();
        core = copilotkit.value;
        return () =>
          h(
            "button",
            {
              "data-testid": "update",
              onClick: () => (description.value = "second"),
            },
            "update",
          );
      },
    });

    const { wrapper } = mountWithProvider(() =>
      h("div", [h(Parent), h(Child)]),
    );
    expect(getContextEntries(core!)[0]?.description).toBe("first");

    await wrapper.find("[data-testid=update]").trigger("click");
    await nextTick();

    const entries = getContextEntries(core!);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.description).toBe("second");
    expect(entries[0]?.value).toBe("same");
  });

  it("re-adds context when value changes", async () => {
    let core:
      | ReturnType<typeof useCopilotKit>["copilotkit"]["value"]
      | undefined;
    const value = ref("first");

    const Child = defineComponent({
      setup() {
        useAgentContext({ description: "fixed", value });
        return () => h("div", "child");
      },
    });

    const Parent = defineComponent({
      setup() {
        const { copilotkit } = useCopilotKit();
        core = copilotkit.value;
        return () =>
          h(
            "button",
            {
              "data-testid": "update",
              onClick: () => (value.value = "second"),
            },
            "update",
          );
      },
    });

    const { wrapper } = mountWithProvider(() =>
      h("div", [h(Parent), h(Child)]),
    );
    expect(getContextEntries(core!)[0]?.value).toBe("first");

    await wrapper.find("[data-testid=update]").trigger("click");
    await nextTick();

    const entries = getContextEntries(core!);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.description).toBe("fixed");
    expect(entries[0]?.value).toBe("second");
  });

  it("serializes string values unchanged", () => {
    let core:
      | ReturnType<typeof useCopilotKit>["copilotkit"]["value"]
      | undefined;
    const Child = defineComponent({
      setup() {
        const { copilotkit } = useCopilotKit();
        core = copilotkit.value;
        useAgentContext({ description: "string", value: "plain" });
        return () => null;
      },
    });

    mountWithProvider(() => h(Child));
    expect(getContextEntries(core!)[0]?.value).toBe("plain");
  });

  it.each([
    ["object", { name: "John", age: 30 }, '{"name":"John","age":30}'],
    ["array", [1, 2, 3, "four"], '[1,2,3,"four"]'],
    ["number", 42, "42"],
    ["boolean", true, "true"],
    ["null", null, "null"],
    [
      "nested",
      {
        user: {
          name: "Alice",
          settings: { theme: "dark", notifications: true },
        },
        items: [1, 2, { nested: "value" }],
      },
      '{"user":{"name":"Alice","settings":{"theme":"dark","notifications":true}},"items":[1,2,{"nested":"value"}]}',
    ],
  ])("serializes %s values", (_name, value, expected) => {
    let core:
      | ReturnType<typeof useCopilotKit>["copilotkit"]["value"]
      | undefined;
    const Child = defineComponent({
      setup() {
        const { copilotkit } = useCopilotKit();
        core = copilotkit.value;
        useAgentContext({ description: "serialized", value: value as never });
        return () => null;
      },
    });

    mountWithProvider(() => h(Child));
    expect(getContextEntries(core!)[0]?.value).toBe(expected);
  });
});
