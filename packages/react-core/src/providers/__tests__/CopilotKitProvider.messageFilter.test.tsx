import { render } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CopilotKitMessageFilter } from "@copilotkit/core";
import { CopilotKitProvider, useCopilotKit } from "../CopilotKitProvider";
import type { CopilotKitCoreReact } from "../../lib/react-core";

/** Keeps the final turn only — the shape #1482 asks for. */
const keepLastTurn: CopilotKitMessageFilter = (messages) => messages.slice(-1);
/** A second, distinguishable filter, for asserting a swap took effect. */
const keepLastTwo: CopilotKitMessageFilter = (messages) => messages.slice(-2);

/**
 * #1482: the `messageFilter` prop. The filter's own behaviour — what reaches
 * the wire, the tool-call repair, the Intelligence and suggestion exemptions —
 * lives in `packages/core/src/__tests__/message-filter.test.ts`. What is
 * React-specific, and what these assert, is that the prop reaches the core on
 * mount and on every later change, including a change back to `undefined`,
 * which is how an app turns trimming off.
 */
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  consoleWarnSpy.mockRestore();
});

function createCoreCollector() {
  const instances: CopilotKitCoreReact[] = [];
  function Collector() {
    const { copilotkit } = useCopilotKit();
    instances.push(copilotkit);
    return null;
  }
  return {
    Collector,
    getCore: () => {
      if (instances.length === 0) {
        throw new Error("CopilotKit core not captured yet");
      }
      return instances[instances.length - 1]!;
    },
  };
}

describe("CopilotKitProvider messageFilter", () => {
  it("threads the filter to the core on mount", () => {
    const { Collector, getCore } = createCoreCollector();
    render(
      <CopilotKitProvider
        runtimeUrl="https://runtime.example/rest"
        messageFilter={keepLastTurn}
      >
        <Collector />
      </CopilotKitProvider>,
    );

    expect(getCore().messageFilter).toBe(keepLastTurn);
  });

  it("leaves the core unfiltered when the prop is absent", () => {
    const { Collector, getCore } = createCoreCollector();

    render(
      <CopilotKitProvider runtimeUrl="https://runtime.example/rest">
        <Collector />
      </CopilotKitProvider>,
    );

    expect(getCore().messageFilter).toBeUndefined();
  });

  it("adopts a filter the app swaps in after mount", () => {
    const { Collector, getCore } = createCoreCollector();
    const view = render(
      <CopilotKitProvider
        runtimeUrl="https://runtime.example/rest"
        messageFilter={keepLastTurn}
      >
        <Collector />
      </CopilotKitProvider>,
    );
    expect(getCore().messageFilter).toBe(keepLastTurn);

    view.rerender(
      <CopilotKitProvider
        runtimeUrl="https://runtime.example/rest"
        messageFilter={keepLastTwo}
      >
        <Collector />
      </CopilotKitProvider>,
    );

    expect(getCore().messageFilter).toBe(keepLastTwo);
  });

  it("clears the filter when the prop goes back to undefined", () => {
    const { Collector, getCore } = createCoreCollector();
    const view = render(
      <CopilotKitProvider
        runtimeUrl="https://runtime.example/rest"
        messageFilter={keepLastTurn}
      >
        <Collector />
      </CopilotKitProvider>,
    );
    expect(getCore().messageFilter).toBe(keepLastTurn);

    view.rerender(
      <CopilotKitProvider runtimeUrl="https://runtime.example/rest">
        <Collector />
      </CopilotKitProvider>,
    );

    expect(getCore().messageFilter).toBeUndefined();
  });
});
