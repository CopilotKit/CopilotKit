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
    // …but it DOES say the call is running. Registering this exact renderer
    // takes the tool off the shell's wildcard chip (spinner included), so
    // rendering nothing here leaves a backend round-trip with no indicator at
    // all — the transcript just sits there.
    expect(container.textContent).toMatch(/Filing a narrative/);
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

  it("does not re-refresh when only the refresh IDENTITY changes", () => {
    // `refresh` comes off the ledger context, which hands out a NEW function
    // every time the snapshot changes — including the refresh this component
    // just fired. Keying the effect on `refresh` instead of routing it through
    // `refreshRef` is therefore a re-read loop: refresh → new snapshot → new
    // `refresh` → refresh. Same call id means one re-read, whatever the
    // identity does.
    const first = vi.fn(() => Promise.resolve());
    const second = vi.fn(() => Promise.resolve());
    const { rerender } = render(
      <NarrativeFiledReceipt
        toolCallId="call-1"
        result='{"narrative":{}}'
        refresh={first}
      />,
    );
    rerender(
      <NarrativeFiledReceipt
        toolCallId="call-1"
        result='{"narrative":{}}'
        refresh={second}
      />,
    );
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();

    // …and the ref DID take the new identity: the next call re-reads through
    // the current `refresh`, not the stale one it first captured.
    rerender(
      <NarrativeFiledReceipt
        toolCallId="call-2"
        result='{"narrative":{}}'
        refresh={second}
      />,
    );
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
  });

  it("shows the backend's note when a filing clears no open breach", () => {
    // `agent.ts` files the narrative and returns a `note` when the (metric,
    // period) it names has no OPEN exception: the write STANDS but it clears
    // nothing the publish gate is waiting on. A bare "Filed the variance
    // narrative." over that reads as the gate contradicting a filing that
    // just worked, and the operator has no way to see why.
    const note =
      "Filed — but revenue has no OPEN exception at 2026-08, so this filing " +
      "clears nothing the publish gate is waiting on.";
    const { container } = render(
      <NarrativeFiledReceipt
        toolCallId="call-note"
        result={JSON.stringify({ narrative: { metricId: "revenue" }, note })}
        refresh={vi.fn(() => Promise.resolve())}
      />,
    );
    expect(container.textContent).toMatch(/Filed the variance narrative/);
    expect(container.textContent).toMatch(/clears nothing the publish gate/);
  });

  it("keeps the plain receipt when the backend sent no note", () => {
    const { container } = render(
      <NarrativeFiledReceipt
        toolCallId="call-plain"
        result='{"narrative":{"metricId":"revenue"}}'
        refresh={vi.fn(() => Promise.resolve())}
      />,
    );
    expect(container.textContent).toBe("Filed the variance narrative.");
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
    // …and nothing was written, so nothing needs re-reading. `refresh` is the
    // one thing on this page that can raise the "saved, but the view may be
    // stale" banner, and raising it for a refusal reports a write that never
    // happened.
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not refresh the ledger for a settle that wrote nothing", () => {
    const cases: Record<string, string> = {
      "an unrecognised-code refusal": '{"error":"BAD_CODE","message":"…"}',
      "a relayed runtime error": "Error: the ledger did not answer",
      "an aborted run": "Error: Human-in-the-loop interaction aborted",
      "an empty settle": "",
    };
    for (const [label, result] of Object.entries(cases)) {
      const refresh = vi.fn(() => Promise.resolve());
      const { unmount } = render(
        <NarrativeFiledReceipt
          toolCallId="call-5"
          result={result}
          refresh={refresh}
        />,
      );
      expect(refresh, label).not.toHaveBeenCalled();
      unmount();
    }
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
    // good snapshot on screen. Asserted on THIS log line specifically — a bare
    // `toHaveBeenCalled()` passes off any console.error React or a library
    // happens to emit, including one that would fire with the refresh removed
    // entirely.
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        "[exec] ledger refresh after narrative filing failed",
        expect.objectContaining({ message: "offline" }),
      ),
    );
    error.mockRestore();
  });
});
