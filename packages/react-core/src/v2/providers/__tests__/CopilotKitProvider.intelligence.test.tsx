import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CopilotKitProvider, useCopilotKit } from "../CopilotKitProvider";

// Must stay byte-identical to the key the Intelligence backend reads.
const RESERVED_KEY = "__copilotkit_intelligence_learning_containers__";

let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  consoleWarnSpy.mockRestore();
});

test("injects configured learningContainers under the reserved properties key", () => {
  const { result } = renderHook(() => useCopilotKit(), {
    wrapper: ({ children }) => (
      <CopilotKitProvider intelligence={{ learningContainers: ["team-a"] }}>
        {children}
      </CopilotKitProvider>
    ),
  });

  expect(result.current.copilotkit.properties[RESERVED_KEY]).toEqual([
    "team-a",
  ]);
});

test("defaults learningContainers to ['project'] when intelligence prop is absent", () => {
  const { result } = renderHook(() => useCopilotKit(), {
    wrapper: ({ children }) => (
      <CopilotKitProvider>{children}</CopilotKitProvider>
    ),
  });

  expect(result.current.copilotkit.properties[RESERVED_KEY]).toEqual([
    "project",
  ]);
});

test("defaults learningContainers to ['project'] when intelligence has no learningContainers", () => {
  const { result } = renderHook(() => useCopilotKit(), {
    wrapper: ({ children }) => (
      <CopilotKitProvider intelligence={{}}>{children}</CopilotKitProvider>
    ),
  });

  expect(result.current.copilotkit.properties[RESERVED_KEY]).toEqual([
    "project",
  ]);
});

test("preserves caller-provided properties alongside the reserved key", () => {
  const { result } = renderHook(() => useCopilotKit(), {
    wrapper: ({ children }) => (
      <CopilotKitProvider
        properties={{ tenantId: "acme" }}
        intelligence={{ learningContainers: ["team-a", "team-b"] }}
      >
        {children}
      </CopilotKitProvider>
    ),
  });

  expect(result.current.copilotkit.properties.tenantId).toBe("acme");
  expect(result.current.copilotkit.properties[RESERVED_KEY]).toEqual([
    "team-a",
    "team-b",
  ]);
});
