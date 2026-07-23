import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mount } from "@vue/test-utils";
import { z } from "zod";
import CopilotKitProvider from "../CopilotKitProvider.vue";
import { useCopilotKit } from "../useCopilotKit";
import { useSandboxFunctions } from "../SandboxFunctionsContext";
import type { SandboxFunction } from "../../types";

function makeSandboxFunction(name: string): SandboxFunction {
  return {
    name,
    description: `${name} description`,
    parameters: z.object({ value: z.string() }),
    handler: vi.fn().mockResolvedValue(undefined),
  };
}

function findSandboxContext(
  context: Record<string, { description: string; value: string }>,
) {
  return Object.values(context).find((entry) =>
    entry.description.includes("Sandbox functions"),
  );
}

function mountProvider(props: Record<string, unknown>) {
  const observedFunctions = ref<readonly SandboxFunction[]>([]);
  const observedCore =
    ref<ReturnType<typeof useCopilotKit>["copilotkit"]["value"]>();

  const Child = defineComponent({
    setup() {
      const functions = useSandboxFunctions();
      const { copilotkit } = useCopilotKit();
      observedFunctions.value = functions.value;
      observedCore.value = copilotkit.value;
      return () => h("div");
    },
  });

  const wrapper = mount(CopilotKitProvider, {
    props: {
      runtimeUrl: "/api/copilotkit",
      ...props,
    },
    slots: {
      default: () => h(Child),
    },
  });

  return { wrapper, observedFunctions, observedCore };
}

describe("CopilotKitProvider sandbox functions", () => {
  it("provides sandbox functions to children via context", () => {
    const fns = [makeSandboxFunction("myFn")];
    const { observedFunctions } = mountProvider({
      openGenerativeUI: { sandboxFunctions: fns },
    });
    expect(observedFunctions.value).toHaveLength(1);
    expect(observedFunctions.value[0].name).toBe("myFn");
  });

  it("provides empty array when openGenerativeUI is not set", () => {
    const { observedFunctions } = mountProvider({});
    expect(observedFunctions.value).toHaveLength(0);
  });

  it("provides empty array when sandboxFunctions is not set", () => {
    const { observedFunctions } = mountProvider({ openGenerativeUI: {} });
    expect(observedFunctions.value).toHaveLength(0);
  });

  it("registers agent context when sandbox functions are provided", () => {
    const { observedCore } = mountProvider({
      openGenerativeUI: {
        sandboxFunctions: [makeSandboxFunction("addToCart")],
      },
    });
    const sandboxContext = findSandboxContext(observedCore.value!.context);
    expect(sandboxContext).toBeDefined();
  });

  it("does not register agent context when sandbox functions are empty", () => {
    const { observedCore } = mountProvider({
      openGenerativeUI: { sandboxFunctions: [] },
    });
    const sandboxContext = findSandboxContext(observedCore.value!.context);
    expect(sandboxContext).toBeUndefined();
  });

  it("does not register agent context when openGenerativeUI is omitted", () => {
    const { observedCore } = mountProvider({});
    const sandboxContext = findSandboxContext(observedCore.value!.context);
    expect(sandboxContext).toBeUndefined();
  });

  it("includes multiple functions in agent context", () => {
    const { observedCore } = mountProvider({
      openGenerativeUI: {
        sandboxFunctions: [
          makeSandboxFunction("fnA"),
          makeSandboxFunction("fnB"),
        ],
      },
    });
    const sandboxContext = findSandboxContext(observedCore.value!.context);
    const parsed = JSON.parse(sandboxContext!.value);
    expect(parsed).toHaveLength(2);
  });

  it("converts parameters to JSON Schema in agent context", () => {
    const functionWithSchema: SandboxFunction = {
      name: "myFn",
      description: "myFn description",
      parameters: z.object({
        itemId: z.string(),
        quantity: z.number(),
      }),
      handler: vi.fn().mockResolvedValue(undefined),
    };
    const { observedCore } = mountProvider({
      openGenerativeUI: { sandboxFunctions: [functionWithSchema] },
    });
    const sandboxContext = findSandboxContext(observedCore.value!.context);
    const parsed = JSON.parse(sandboxContext!.value);
    expect(parsed[0].parameters.type).toBe("object");
    expect(parsed[0].parameters.properties.itemId.type).toBe("string");
    expect(parsed[0].parameters.properties.quantity.type).toBe("number");
  });

  it("removes agent context on unmount", () => {
    const { wrapper, observedCore } = mountProvider({
      openGenerativeUI: { sandboxFunctions: [makeSandboxFunction("myFn")] },
    });
    expect(findSandboxContext(observedCore.value!.context)).toBeDefined();
    wrapper.unmount();
    expect(findSandboxContext(observedCore.value!.context)).toBeUndefined();
  });
});
