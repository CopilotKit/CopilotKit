import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Harness from "./provider-harness.svelte";

describe("CopilotKitProvider", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              version: "test",
              agents: {},
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
      ),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("provides merged configuration and updates it reactively", async () => {
    const view = render(Harness);

    await waitFor(() =>
      expect(view.getByTestId("runtime-url").textContent).toBe(
        "https://runtime-a.test",
      ),
    );
    expect(JSON.parse(view.getByTestId("headers").textContent ?? "{}")).toEqual(
      {
        "X-Test": "a",
        "X-CopilotCloud-Public-Api-Key": "ck_pub_test",
      },
    );

    await fireEvent.click(view.getByTestId("update-provider"));
    await waitFor(() =>
      expect(view.getByTestId("runtime-url").textContent).toBe(
        "https://runtime-b.test",
      ),
    );
    expect(JSON.parse(view.getByTestId("headers").textContent ?? "{}")).toEqual(
      {
        "X-Test": "b",
        "X-CopilotCloud-Public-Api-Key": "ck_pub_test",
      },
    );
  });

  it("does not drop a second tool call when the first call ends", async () => {
    vi.useFakeTimers();
    const view = render(Harness);

    await fireEvent.click(view.getByTestId("overlap-tool-calls"));
    await vi.runAllTimersAsync();

    expect(
      JSON.parse(view.getByTestId("executing-tool-calls").textContent ?? "[]"),
    ).toEqual(["call-b"]);
    vi.useRealTimers();
  });

  it("preserves hook-registered frontend tools after provider synchronization", async () => {
    const view = render(Harness);

    await fireEvent.click(view.getByTestId("check-frontend-tool"));

    expect(view.getByTestId("frontend-tool-registered").textContent).toBe(
      "true",
    );
  });
});
