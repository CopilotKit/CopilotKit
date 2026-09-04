import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NarrativeFiledReceipt } from "./tools";

/**
 * `file_variance_narrative` is exec's ONLY backend write (`agent.ts` calls
 * `store.fileNarrative` inside the runtime process). No client code runs for
 * it, so nothing re-reads `GET /api/exec/v1/ledger` — the Board Packs
 * narrative list, the exception rows and their `explained` flags all keep
 * showing the snapshot from before the filing until some unrelated write
 * happens to refresh. On stage that reads as a filing that did not take, and
 * beat 6's whole point is that filing IS what clears the gate.
 *
 * `NarrativeFiledReceipt` is the fix: `ExecTools` registers it as the exact
 * tool-call renderer for that tool name, and it calls `refresh()` when the
 * call settles. The refresh is invisible from the outside, which is exactly
 * why it is tested here rather than left to the renderer's registration.
 */
describe("NarrativeFiledReceipt", () => {
  it("refreshes the ledger once when the backend filing settles", () => {
    const refresh = vi.fn(() => Promise.resolve());
    render(
      <NarrativeFiledReceipt
        toolCallId="call-1"
        result='{"narrative":{"metricId":"opex"}}'
        refresh={refresh}
      />,
    );
    expect(
      refresh,
      "without this the ledger keeps serving the pre-filing snapshot",
    ).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Filed the variance narrative/)).toBeTruthy();
  });

  it("does NOT refresh while the call is still streaming", () => {
    // `result` is undefined for the inProgress/executing statuses. Refreshing
    // then would re-read the ledger BEFORE the write landed and cache the
    // stale snapshot for the rest of the turn — worse than not refreshing.
    const refresh = vi.fn(() => Promise.resolve());
    const { container } = render(
      <NarrativeFiledReceipt
        toolCallId="call-1"
        result={undefined}
        refresh={refresh}
      />,
    );
    expect(refresh).not.toHaveBeenCalled();
    expect(container.textContent).toBe("");
  });

  it("does not refresh again on a re-render of the same call", () => {
    const refresh = vi.fn(() => Promise.resolve());
    const { rerender } = render(
      <NarrativeFiledReceipt
        toolCallId="call-1"
        result='{"narrative":{}}'
        refresh={refresh}
      />,
    );
    rerender(
      <NarrativeFiledReceipt
        toolCallId="call-1"
        result='{"narrative":{}}'
        refresh={refresh}
      />,
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("reads a BAD_CODE refusal back as a refusal, not as a filing", () => {
    // The mere PRESENCE of a settled result is never treated as success —
    // `agent.ts`'s guard returns `{ error: "BAD_CODE" }` for a code outside
    // the ledger's catalogue, and printing "Filed" over that would assert a
    // durable write that never happened, identically on every replay.
    const refresh = vi.fn(() => Promise.resolve());
    render(
      <NarrativeFiledReceipt
        toolCallId="call-2"
        result='{"error":"BAD_CODE","message":"…"}'
        refresh={refresh}
      />,
    );
    expect(screen.getByText(/isn.t one this ledger files under/)).toBeTruthy();
    expect(screen.queryByText(/Filed the variance narrative/)).toBeNull();
  });

  it("does not read an error-relayed settle as a filing that happened", () => {
    // Same rule as every other render in `tools.tsx` (see
    // `./tool-settle.test.tsx`): the PRESENCE of a settled string is not an
    // outcome. A relayed runtime error is not a filed narrative.
    const refresh = vi.fn(() => Promise.resolve());
    const { container } = render(
      <NarrativeFiledReceipt
        toolCallId="call-4"
        result="Error: the ledger did not answer"
        refresh={refresh}
      />,
    );
    expect(container.textContent).not.toMatch(/Filed the variance narrative/);
    expect(
      container
        .querySelector("[data-settle-tone]")
        ?.getAttribute("data-settle-tone"),
    ).toBe("negative");
  });

  it("survives a refresh that rejects, without throwing into the transcript", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const refresh = vi.fn(() => Promise.reject(new Error("offline")));
    expect(() =>
      render(
        <NarrativeFiledReceipt
          toolCallId="call-3"
          result='{"narrative":{}}'
          refresh={refresh}
        />,
      ),
    ).not.toThrow();
    // The rejection is logged rather than swallowed: a ledger that stopped
    // answering has to be diagnosable, and `refresh` already leaves the last
    // good snapshot on screen.
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    error.mockRestore();
  });
});
