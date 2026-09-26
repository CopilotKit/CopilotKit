import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Harness from "./prebuilt-tool-rendering-harness.svelte";
import RejectHarness from "./reject-human-in-the-loop-harness.svelte";
import WildcardHarness from "./prebuilt-tool-wildcard-harness.svelte";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ version: "test", agents: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("prebuilt chat tool rendering", () => {
  it("uses a matching renderer and keeps the generic fallback", async () => {
    const view = render(Harness);

    await waitFor(() =>
      expect(view.getByText("weather:weather-1:complete:London:Sunny")).toBeTruthy(),
    );
    expect(view.queryByText("scoped-other")).toBeNull();
    expect(view.getByText("ping")).toBeTruthy();
    expect(view.queryByTestId("respond-call-a")).toBeNull();
  });

  it("uses a global wildcard when no named renderer matches the current agent", async () => {
    const view = render(WildcardHarness);

    await waitFor(() =>
      expect(view.getByText("wild:audit:audit-1")).toBeTruthy(),
    );
    expect(view.queryByText("wild-other")).toBeNull();
  });

  it("resolves concurrent human-in-the-loop calls by tool call id", async () => {
    const view = render(Harness);

    await waitFor(() =>
      expect(view.getByTestId("hitl-status-call-a").textContent).toBe(
        "inProgress",
      ),
    );
    expect(view.getByTestId("hitl-topic-call-a").textContent).toBe("alpha");
    expect(view.getByTestId("hitl-topic-call-b").textContent).toBe("beta");

    await fireEvent.click(view.getByTestId("start-hitl"));

    await waitFor(() =>
      expect(view.getByTestId("hitl-status-call-a").textContent).toBe(
        "executing",
      ),
    );
    expect(view.getByTestId("hitl-status-call-b").textContent).toBe(
      "executing",
    );

    await fireEvent.click(view.getByTestId("respond-call-b"));
    await waitFor(() =>
      expect(view.getByTestId("hitl-second").textContent).toBe("yes:call-b"),
    );
    expect(view.getByTestId("hitl-first").textContent).toBe("");

    await fireEvent.click(view.getByTestId("respond-call-a"));
    await waitFor(() =>
      expect(view.getByTestId("hitl-first").textContent).toBe("yes:call-a"),
    );
    expect(view.getByTestId("hitl-second").textContent).toBe("yes:call-b");
  });

  it("rejects provider humanInTheLoop instead of resolving an empty result", () => {
    expect(() => render(RejectHarness)).toThrow(/registerHumanInTheLoop/);
  });
});
