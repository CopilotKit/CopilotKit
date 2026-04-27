import { renderHook } from "../../../test-helpers/render-hook";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { CopilotKitProvider, useCopilotKit } from "../CopilotKitProvider";
import { useSandboxFunctions } from "../SandboxFunctionsContext";
import type { SandboxFunction } from "../../types/sandbox-function";

describe("CopilotKitProvider — openGenerativeUI.sandboxFunctions", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const makeSandboxFunction = (
    name: string,
    overrides?: Partial<SandboxFunction>,
  ): SandboxFunction => ({
    name,
    description: `${name} description`,
    parameters: z.object({ value: z.string() }),
    handler: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });

  /** Helper: find the sandbox-functions context entry from the context record */
  function findSandboxContext(
    ctx: Record<string, { description: string; value: string }>,
  ) {
    return Object.values(ctx).find((c) =>
      c.description.includes("Sandbox functions"),
    );
  }

  describe("SandboxFunctionsContext", () => {
    it("provides sandbox functions to children via context", () => {
      const fns = [makeSandboxFunction("myFn")];

      const { result } = renderHook(() => useSandboxFunctions(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider openGenerativeUI={{ sandboxFunctions: fns }}>
            {children}
          </CopilotKitProvider>
        ),
      });

      expect(result.current).toHaveLength(1);
      expect(result.current[0].name).toBe("myFn");
    });

    it("provides empty array when openGenerativeUI is not set", () => {
      const { result } = renderHook(() => useSandboxFunctions(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider>{children}</CopilotKitProvider>
        ),
      });

      expect(result.current).toHaveLength(0);
    });

    it("provides empty array when sandboxFunctions is not set", () => {
      const { result } = renderHook(() => useSandboxFunctions(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider openGenerativeUI={{}}>
            {children}
          </CopilotKitProvider>
        ),
      });

      expect(result.current).toHaveLength(0);
    });
  });

  describe("agent context registration", () => {
    it("registers agent context when sandbox functions are provided", () => {
      const fns = [makeSandboxFunction("addToCart")];

      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider openGenerativeUI={{ sandboxFunctions: fns }}>
            {children}
          </CopilotKitProvider>
        ),
      });

      const sandboxContext = findSandboxContext(
        result.current.copilotkit.context,
      );
      expect(sandboxContext).toBeDefined();

      const parsed = JSON.parse(sandboxContext!.value);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe("addToCart");
      expect(parsed[0].description).toBe("addToCart description");
      expect(parsed[0].parameters).toBeDefined();
      expect(parsed[0].parameters.type).toBe("object");
    });

    it("does not register agent context when sandbox functions are empty", () => {
      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider openGenerativeUI={{ sandboxFunctions: [] }}>
            {children}
          </CopilotKitProvider>
        ),
      });

      const sandboxContext = findSandboxContext(
        result.current.copilotkit.context,
      );
      expect(sandboxContext).toBeUndefined();
    });

    it("does not register agent context when openGenerativeUI is omitted", () => {
      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider>{children}</CopilotKitProvider>
        ),
      });

      const sandboxContext = findSandboxContext(
        result.current.copilotkit.context,
      );
      expect(sandboxContext).toBeUndefined();
    });

    it("includes multiple functions in agent context", () => {
      const fns = [makeSandboxFunction("fnA"), makeSandboxFunction("fnB")];

      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider openGenerativeUI={{ sandboxFunctions: fns }}>
            {children}
          </CopilotKitProvider>
        ),
      });

      const sandboxContext = findSandboxContext(
        result.current.copilotkit.context,
      );
      const parsed = JSON.parse(sandboxContext!.value);
      expect(parsed).toHaveLength(2);
      expect(parsed.map((f: any) => f.name)).toEqual(["fnA", "fnB"]);
    });

    it("converts parameters to JSON Schema in agent context", () => {
      const fns = [
        makeSandboxFunction("myFn", {
          parameters: z.object({
            itemId: z.string(),
            quantity: z.number(),
          }),
        }),
      ];

      const { result } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider openGenerativeUI={{ sandboxFunctions: fns }}>
            {children}
          </CopilotKitProvider>
        ),
      });

      const sandboxContext = findSandboxContext(
        result.current.copilotkit.context,
      );
      const parsed = JSON.parse(sandboxContext!.value);
      const params = parsed[0].parameters;

      expect(params.type).toBe("object");
      expect(params.properties.itemId).toEqual({ type: "string" });
      expect(params.properties.quantity).toEqual({ type: "number" });
    });

    it("removes agent context on unmount", () => {
      const fns = [makeSandboxFunction("myFn")];

      const { result, unmount } = renderHook(() => useCopilotKit(), {
        wrapper: ({ children }) => (
          <CopilotKitProvider openGenerativeUI={{ sandboxFunctions: fns }}>
            {children}
          </CopilotKitProvider>
        ),
      });

      const copilotkit = result.current.copilotkit;
      expect(findSandboxContext(copilotkit.context)).toBeDefined();

      unmount();

      expect(findSandboxContext(copilotkit.context)).toBeUndefined();
    });
  });
});
