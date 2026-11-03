/**
 * #4952: with `openGenerativeUI` enabled on the runtime and no
 * `openGenerativeUI` prop on the provider, tools registered through
 * `useFrontendTool` / `useHumanInTheLoop` were silently dropped — the agent
 * only ever saw `generateSandboxedUi`.
 *
 * Mechanism: hooks register through `addTool()`, while the provider re-syncs
 * its own tool list wholesale through `setTools()`. The `/info` response
 * flipping `openGenerativeUIEnabled` re-derives that list after mount, and the
 * re-sync replaced the whole registry — hook tools included.
 *
 * This test drives the real core over a stubbed `/info`, so it fails if the
 * registry goes back to a single array.
 */
import React from "react";
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { CopilotKitProvider, useCopilotKit } from "../CopilotKitProvider";
import { useFrontendTool } from "../../hooks/use-frontend-tool";

const RUNTIME_URL = "https://runtime.example/api/copilotkit";

function stubRuntimeInfo(openGenerativeUIEnabled: boolean) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = url.endsWith("/info")
      ? { version: "1.0.0", agents: {}, openGenerativeUIEnabled }
      : {};
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
}

describe("CopilotKitProvider — runtime openGenerativeUI vs hook tools (#4952)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function renderWithRuntime() {
    // Captured from context; read live in assertions rather than snapshotted
    // during render, since the registry is updated from effects.
    let core: { tools: ReadonlyArray<{ name: string }> } | undefined;
    const toolNames = () => (core?.tools ?? []).map((t) => t.name);

    function Child() {
      const { copilotkit } = useCopilotKit();
      core = copilotkit;

      useFrontendTool({
        name: "sayHello",
        description: "Say hello to the user",
        parameters: z.object({ name: z.string() }),
        handler: async () => "hi",
      });

      return <div data-testid="child" />;
    }

    const utils = render(
      <CopilotKitProvider runtimeUrl={RUNTIME_URL} useSingleEndpoint={false}>
        <Child />
      </CopilotKitProvider>,
    );

    return { ...utils, toolNames };
  }

  it("keeps the hook tool once the runtime turns openGenerativeUI on", async () => {
    global.fetch = stubRuntimeInfo(true) as unknown as typeof fetch;

    const { toolNames } = renderWithRuntime();

    // The built-in arrives only after /info resolves and the provider re-syncs.
    await waitFor(() => {
      expect(toolNames()).toContain("generateSandboxedUi");
    });

    // The re-sync must not have taken the hook's tool with it.
    expect(toolNames()).toContain("sayHello");
  });

  it("keeps the hook tool when the runtime leaves openGenerativeUI off", async () => {
    global.fetch = stubRuntimeInfo(false) as unknown as typeof fetch;

    const { toolNames } = renderWithRuntime();

    await waitFor(() => {
      expect(toolNames()).toContain("sayHello");
    });
    expect(toolNames()).not.toContain("generateSandboxedUi");
  });
});
