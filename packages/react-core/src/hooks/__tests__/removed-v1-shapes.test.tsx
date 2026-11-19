import React from "react";
import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotKitProvider } from "../../providers/CopilotKitProvider";
import { useFrontendTool } from "../use-frontend-tool";
import { useHumanInTheLoop } from "../use-human-in-the-loop";
import { useRenderToolCall } from "../use-render-tool-call";
import { useThreads } from "../use-threads";

// The 1.x calls of the hooks that 2.0 kept under the same name. Each one
// throws a CopilotKitRemovedApiError that names the replacement.

/** A `CopilotKitRemovedApiError` whose message contains `message`. */
function removalError(message: string) {
  return expect.objectContaining({
    name: "CopilotKitRemovedApiError",
    code: "REMOVED_API",
    message: expect.stringContaining(message),
  });
}

/** A 1.x `Parameter[]` list. */
const PARAMETER_LIST = [{ name: "city", type: "string", required: true }];

function Provider({ children }: { children: ReactNode }) {
  return <CopilotKitProvider>{children}</CopilotKitProvider>;
}

beforeEach(() => {
  // React logs the error of a render before it throws the error, and the
  // provider warns that it has no runtime.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

describe("useFrontendTool and useHumanInTheLoop with a Parameter[] list", () => {
  it("useFrontendTool throws the removal error", () => {
    expect(() =>
      renderHook(() =>
        useFrontendTool({
          name: "getWeather",
          // @ts-expect-error -- 2.0 takes a Standard Schema
          parameters: PARAMETER_LIST,
        }),
      ),
    ).toThrow(
      removalError(
        'A Parameter[] list in "parameters" of useFrontendTool was removed in CopilotKit 2.0.',
      ),
    );
  });

  it("useHumanInTheLoop throws the removal error", () => {
    expect(() =>
      renderHook(() =>
        useHumanInTheLoop({
          name: "confirmBooking",
          // @ts-expect-error -- 2.0 takes a Standard Schema
          parameters: PARAMETER_LIST,
          render: () => null,
        }),
      ),
    ).toThrow(
      removalError(
        'A Parameter[] list in "parameters" of useHumanInTheLoop was removed in CopilotKit 2.0.',
      ),
    );
  });
});

describe("useRenderToolCall with the 1.x arguments", () => {
  it("throws the removal error, which points to useRenderTool", () => {
    expect(() =>
      renderHook(() =>
        // @ts-expect-error -- 2.0 takes no arguments
        useRenderToolCall({ name: "showStatus", render: () => null }),
      ),
    ).toThrow(
      removalError(
        '"useRenderToolCall(tool, deps)" was removed in CopilotKit 2.0. To register a renderer for a tool, use useRenderTool from @copilotkit/react-core. useRenderToolCall() takes no arguments: it returns a function that renders a tool call. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/removed-apis-2.0#userendertoolcall-with-arguments',
      ),
    );
  });
});

describe("useThreads with the 1.x shapes", () => {
  function renderThreads() {
    return renderHook(() => useThreads({ agentId: "default" }), {
      wrapper: Provider,
    });
  }

  it("throws the removal error when code calls it without arguments", () => {
    expect(() =>
      // @ts-expect-error -- 2.0 takes { agentId }
      renderHook(() => useThreads(), { wrapper: Provider }),
    ).toThrow(
      removalError(
        '"useThreads()" without arguments was removed in CopilotKit 2.0. useThreads({ agentId }) lists the threads of an agent. To read or set the current thread, use useCopilotChatConfiguration() from @copilotkit/react-core. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/removed-apis-2.0#usethreads',
      ),
    );
  });

  it.each([
    [
      "threadId",
      "Read threadId from useCopilotChatConfiguration() of @copilotkit/react-core.",
    ],
    [
      "setThreadId",
      "Call setActiveThreadId(threadId) on useCopilotChatConfiguration() of @copilotkit/react-core.",
    ],
    [
      "isThreadIdExplicit",
      "Read hasExplicitThreadId from useCopilotChatConfiguration() of @copilotkit/react-core.",
    ],
  ])(
    "throws the removal error when code reads %s from the result",
    (field, use) => {
      const { result } = renderThreads();

      expect(() => Reflect.get(result.current, field)).toThrow(
        removalError(
          `"${field}" from useThreads was removed in CopilotKit 2.0. ${use}`,
        ),
      );
    },
  );

  it("keeps the 1.x fields out of a copy of the result", () => {
    const { result } = renderThreads();

    const copy = { ...result.current };

    expect(copy.threads).toEqual([]);
    expect(Object.keys(copy)).not.toContain("threadId");
  });
});
