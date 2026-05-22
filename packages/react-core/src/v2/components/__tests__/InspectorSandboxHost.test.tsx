import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { z } from "zod";
import { ToolCallStatus } from "@copilotkit/core";

import { InspectorSandboxHost } from "../InspectorSandboxHost";
import { CopilotKitContext } from "../../context";
import { CopilotKitCoreReact } from "../../lib/react-core";
import { encodeSandboxArgs } from "../../lib/sandbox-params";

/**
 * Build a minimal CopilotKit context value carrying one render-bearing tool.
 * We instantiate the real CopilotKitCoreReact so `renderToolCalls` is a real
 * getter rather than a stub.
 */
function makeContext(
  tools: Array<{
    name: string;
    render: React.ComponentType<any>;
  }>,
) {
  const core = new CopilotKitCoreReact({
    runtimeUrl: undefined,
    runtimeTransport: "auto",
  });
  core.setRenderToolCalls(
    tools.map((t) => ({
      name: t.name,
      args: z.any(),
      render: t.render,
    })),
  );
  return {
    copilotkit: core,
    executingToolCallIds: new Set<string>(),
  };
}

function withCopilotKitContext(
  ctx: ReturnType<typeof makeContext>,
  ui: React.ReactNode,
) {
  return (
    <CopilotKitContext.Provider value={ctx}>{ui}</CopilotKitContext.Provider>
  );
}

const ORIGINAL_LOCATION = window.location;

function setSandboxUrl(toolName: string | null, args?: unknown): void {
  let url = "http://localhost:3000/";
  if (toolName) {
    const params = new URLSearchParams();
    params.set("__cpk_sandbox", toolName);
    if (args !== undefined) {
      const encoded = encodeSandboxArgs(args);
      if (encoded) params.set("args", encoded);
    }
    url = `http://localhost:3000/?${params.toString()}`;
  }
  // jsdom lets us mutate window.location via Object.defineProperty.
  Object.defineProperty(window, "location", {
    value: new URL(url),
    writable: true,
    configurable: true,
  });
}

describe("InspectorSandboxHost: passthrough", () => {
  beforeEach(() => {
    setSandboxUrl(null);
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: ORIGINAL_LOCATION,
      writable: true,
      configurable: true,
    });
  });

  it("renders children unchanged when no sandbox param is present", () => {
    const ctx = makeContext([]);
    const { container } = render(
      withCopilotKitContext(
        ctx,
        <InspectorSandboxHost>
          <div data-testid="app">Normal app render</div>
        </InspectorSandboxHost>,
      ),
    );
    expect(container.textContent).toContain("Normal app render");
    expect(screen.getByTestId("app")).toBeTruthy();
  });
});

describe("InspectorSandboxHost: sandbox mode", () => {
  beforeEach(() => {
    setSandboxUrl(null);
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: ORIGINAL_LOCATION,
      writable: true,
      configurable: true,
    });
  });

  it("renders ONLY the matching tool.render(args) — no children", () => {
    setSandboxUrl("stock_chart", { ticker: "MSFT" });
    const ToolComponent = ({
      args,
      status,
    }: {
      args: { ticker?: string };
      status: ToolCallStatus;
    }) => (
      <div data-testid="tool-out">
        {status === ToolCallStatus.Executing ? "executing" : "other"}:
        {args.ticker ?? "(no ticker)"}
      </div>
    );

    const ctx = makeContext([{ name: "stock_chart", render: ToolComponent }]);

    render(
      withCopilotKitContext(
        ctx,
        <InspectorSandboxHost>
          <div data-testid="app-chrome">Should not render in sandbox</div>
        </InspectorSandboxHost>,
      ),
    );

    expect(screen.getByTestId("tool-out").textContent).toBe("executing:MSFT");
    expect(screen.queryByTestId("app-chrome")).toBeNull();
  });

  it("renders the not-found placeholder when the tool is unknown", () => {
    setSandboxUrl("missing_tool", {});
    const ctx = makeContext([]);
    render(
      withCopilotKitContext(
        ctx,
        <InspectorSandboxHost>
          <div data-testid="app-chrome">Should not render in sandbox</div>
        </InspectorSandboxHost>,
      ),
    );
    expect(screen.getByText(/Tool not found/i)).toBeTruthy();
    expect(screen.queryByTestId("app-chrome")).toBeNull();
  });

  it("posts `ready` to the parent on mount", () => {
    setSandboxUrl("stock_chart", { ticker: "AAPL" });
    const ToolComponent = () => <div>tool</div>;
    const ctx = makeContext([{ name: "stock_chart", render: ToolComponent }]);

    const postSpy = vi.fn();
    Object.defineProperty(window, "parent", {
      value: { postMessage: postSpy },
      writable: true,
      configurable: true,
    });

    render(
      withCopilotKitContext(
        ctx,
        <InspectorSandboxHost>
          <div>app</div>
        </InspectorSandboxHost>,
      ),
    );

    const readyCalls = postSpy.mock.calls.filter(
      ([msg]) => (msg as { kind?: string })?.kind === "ready",
    );
    expect(readyCalls).toHaveLength(1);
    const ready = readyCalls[0]![0];
    expect(ready).toMatchObject({ kind: "ready", needsArgs: false });
  });

  it("sets needsArgs:true on `ready` when the URL omitted args", () => {
    setSandboxUrl("stock_chart"); // no args
    const ToolComponent = () => <div>tool</div>;
    const ctx = makeContext([{ name: "stock_chart", render: ToolComponent }]);

    const postSpy = vi.fn();
    Object.defineProperty(window, "parent", {
      value: { postMessage: postSpy },
      writable: true,
      configurable: true,
    });

    render(
      withCopilotKitContext(
        ctx,
        <InspectorSandboxHost>
          <div>app</div>
        </InspectorSandboxHost>,
      ),
    );

    const ready = postSpy.mock.calls.find(
      ([msg]) => (msg as { kind?: string })?.kind === "ready",
    );
    expect(ready).toBeDefined();
    expect(ready![0]).toMatchObject({ kind: "ready", needsArgs: true });
  });

  it("posts a render-error when the tool is not found", async () => {
    setSandboxUrl("missing_tool", {});
    const ctx = makeContext([]);

    const postSpy = vi.fn();
    Object.defineProperty(window, "parent", {
      value: { postMessage: postSpy },
      writable: true,
      configurable: true,
    });

    render(
      withCopilotKitContext(
        ctx,
        <InspectorSandboxHost>
          <div>app</div>
        </InspectorSandboxHost>,
      ),
    );

    // The effect that posts render-error runs after commit; let microtasks
    // flush.
    await act(async () => {
      await Promise.resolve();
    });

    const errorCall = postSpy.mock.calls.find(
      ([msg]) => (msg as { kind?: string })?.kind === "render-error",
    );
    expect(errorCall).toBeDefined();
    expect(errorCall![0].message).toContain("missing_tool");
  });
});
