import { render, act, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { z } from "zod";
import { ToolCallStatus } from "@copilotkit/core";

import { InspectorSandboxHost } from "../InspectorSandboxHost";
import { CopilotKitContext } from "../../context";
import { CopilotKitCoreReact } from "../../lib/react-core";

/**
 * End-to-end-ish test: verifies the full postMessage handshake between the
 * sandbox host and a simulated parent. The flow under test:
 *
 *   1. URL has `?__cpk_sandbox=foo` (no args blob) — host renders the tool
 *      with `{}` args, posts `{ kind: "ready", needsArgs: true }`.
 *   2. Parent responds with `{ kind: "args", args: {...} }`.
 *   3. Host re-renders the tool with the posted args.
 *   4. Tool throws on the new render → host catches via the error boundary
 *      and posts `{ kind: "render-error", message, stack }` to the parent.
 *
 * The simulated parent records every postMessage it receives.
 */

const ORIGINAL_LOCATION = window.location;
const ORIGINAL_PARENT = window.parent;

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

describe("InspectorSandboxHost: postMessage handshake", () => {
  let parentMessages: unknown[];

  beforeEach(() => {
    parentMessages = [];
    // Set up the URL — sandbox mode, no args in URL.
    Object.defineProperty(window, "location", {
      value: new URL("http://localhost:3000/?__cpk_sandbox=foo"),
      writable: true,
      configurable: true,
    });
    // Set up a fake parent that just records messages.
    Object.defineProperty(window, "parent", {
      value: {
        postMessage: (msg: unknown) => {
          parentMessages.push(msg);
        },
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: ORIGINAL_LOCATION,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, "parent", {
      value: ORIGINAL_PARENT,
      writable: true,
      configurable: true,
    });
  });

  it("completes the ready → args → re-render handshake", async () => {
    const renderSpy = vi.fn();
    const Tool: React.FC<{
      args: { ticker?: string };
      status: ToolCallStatus;
    }> = ({ args, status }) => {
      renderSpy(args, status);
      return (
        <div data-testid="tool-out">
          {status === ToolCallStatus.Executing ? "executing" : "other"}:
          {args.ticker ?? "(no ticker)"}
        </div>
      );
    };

    const ctx = makeContext([{ name: "foo", render: Tool }]);

    render(
      <CopilotKitContext.Provider value={ctx}>
        <InspectorSandboxHost>
          <div>app</div>
        </InspectorSandboxHost>
      </CopilotKitContext.Provider>,
    );

    // 1. Ready event posted with needsArgs:true (URL had no args).
    expect(
      parentMessages.filter((m) => (m as { kind?: string })?.kind === "ready"),
    ).toHaveLength(1);
    expect(parentMessages[0]).toMatchObject({
      kind: "ready",
      needsArgs: true,
    });

    // 2. Tool initially rendered with {} args.
    expect(screen.getByTestId("tool-out").textContent).toBe(
      "executing:(no ticker)",
    );

    // 3. Parent posts args. Use act() so the state update commits.
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { kind: "args", args: { ticker: "MSFT" } },
        }),
      );
    });

    // 4. Tool re-rendered with posted args.
    expect(screen.getByTestId("tool-out").textContent).toBe("executing:MSFT");
  });

  it("posts render-error when the tool throws on a posted args update", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const Tool: React.FC<{ args: { explode?: boolean } }> = ({ args }) => {
      if (args.explode) {
        throw new Error("kaboom");
      }
      return <div data-testid="ok">ok</div>;
    };

    const ctx = makeContext([{ name: "foo", render: Tool }]);

    render(
      <CopilotKitContext.Provider value={ctx}>
        <InspectorSandboxHost>
          <div>app</div>
        </InspectorSandboxHost>
      </CopilotKitContext.Provider>,
    );

    // Drop the initial `ready` message so subsequent assertions are cleaner.
    parentMessages.length = 0;

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { kind: "args", args: { explode: true } },
        }),
      );
    });

    const renderErrors = parentMessages.filter(
      (m) => (m as { kind?: string })?.kind === "render-error",
    );
    expect(renderErrors.length).toBeGreaterThanOrEqual(1);
    const error = renderErrors[0] as { message: string; stack?: string };
    expect(error.message).toBe("kaboom");
    expect(typeof error.stack).toBe("string");

    errSpy.mockRestore();
  });
});
