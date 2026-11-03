import React, { Activity, StrictMode } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopilotKitProvider, useCopilotKit } from "../CopilotKitProvider";
import type { CopilotKitCoreReact } from "../../lib/react-core";

const MISSING_CONFIG =
  "Missing required prop: 'runtimeUrl' or 'publicApiKey' or 'publicLicenseKey'";

/** Records every core the provider hands to its children. */
function renderCapturingCores(
  element: (probe: React.ReactNode) => React.ReactElement,
) {
  const cores: CopilotKitCoreReact[] = [];
  function Probe() {
    const { copilotkit } = useCopilotKit();
    if (!cores.includes(copilotkit)) cores.push(copilotkit);
    return null;
  }
  const view = render(element(<Probe />));
  return { cores, ...view };
}

/** Resolve after the provider's deferred dispose has had its chance to run. */
const nextTask = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("CopilotKitProvider core lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("disposes the core on unmount", async () => {
    const { cores, unmount } = renderCapturingCores((probe) => (
      <CopilotKitProvider runtimeUrl="/api/copilotkit">
        {probe}
      </CopilotKitProvider>
    ));
    const [core] = cores;
    if (!core) throw new Error("no core rendered");
    const dispose = vi.spyOn(core, "dispose");

    unmount();
    await waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));
  });

  it("keeps one live core through the StrictMode remount", async () => {
    const { cores, unmount } = renderCapturingCores((probe) => (
      <StrictMode>
        <CopilotKitProvider runtimeUrl="/api/copilotkit">
          {probe}
        </CopilotKitProvider>
      </StrictMode>
    ));
    const [core] = cores;
    if (!core) throw new Error("no core rendered");
    const dispose = vi.spyOn(core, "dispose");

    await nextTask();
    expect(dispose).not.toHaveBeenCalled();
    expect(cores).toHaveLength(1);

    unmount();
    await waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));
  });

  it("replaces a disposed core when effects mount again", async () => {
    const tree = (mode: "visible" | "hidden", probe: React.ReactNode) => (
      <Activity mode={mode}>
        <CopilotKitProvider runtimeUrl="/api/copilotkit">
          {probe}
        </CopilotKitProvider>
      </Activity>
    );
    const cores: CopilotKitCoreReact[] = [];
    function Probe() {
      const { copilotkit } = useCopilotKit();
      if (!cores.includes(copilotkit)) cores.push(copilotkit);
      return null;
    }
    const { rerender } = render(tree("visible", <Probe />));
    const [first] = cores;
    if (!first) throw new Error("no core rendered");
    const dispose = vi.spyOn(first, "dispose");

    rerender(tree("hidden", <Probe />));
    await waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));

    await act(async () => {
      rerender(tree("visible", <Probe />));
    });
    await waitFor(() => expect(cores).toHaveLength(2));
    expect(cores[1]).not.toBe(first);
  });
});

describe("CopilotKitProvider config diagnostics", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("warns about a missing runtime config once across rerenders", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { rerender } = render(
      <CopilotKitProvider>
        <div />
      </CopilotKitProvider>,
    );
    rerender(
      <CopilotKitProvider>
        <span />
      </CopilotKitProvider>,
    );
    const missing = warn.mock.calls.filter(
      ([message]) => message === MISSING_CONFIG,
    );
    expect(missing).toHaveLength(1);
  });

  it("throws for a missing runtime config in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(
        <CopilotKitProvider>
          <div />
        </CopilotKitProvider>,
      ),
    ).toThrow(MISSING_CONFIG);
  });
});
