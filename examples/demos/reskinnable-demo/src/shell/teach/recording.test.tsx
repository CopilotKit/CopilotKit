import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import {
  RecordingProvider,
  RecordingFeed,
  RecordingVignette,
  useRecording,
} from "@/shell/teach";

/** Drives the hook from inside the provider and exposes it to the test. */
function harness() {
  const api: { current: ReturnType<typeof useRecording> | null } = {
    current: null,
  };
  function Probe() {
    api.current = useRecording();
    return (
      <>
        <RecordingFeed />
        <RecordingVignette />
      </>
    );
  }
  render(
    <RecordingProvider>
      <Probe />
    </RecordingProvider>,
  );
  return api as { current: ReturnType<typeof useRecording> };
}

// Plain fake timers, NOT { shouldAdvanceTime: true }. The MIN_VISIBLE_MS test
// asserts the flag is still true at 1199ms and false at 1201ms; a clock that
// also advances with real time would make that boundary flaky. Every act() below
// is synchronous, so nothing needs real time to progress.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("recording", () => {
  it("is idle before any bracket", () => {
    const api = harness();
    expect(api.current.isRecording).toBe(false);
    expect(api.current.steps).toEqual([]);
  });

  it("ref-counts overlapping brackets instead of flickering off", () => {
    const api = harness();
    act(() => api.current.beginRecording());
    act(() => api.current.beginRecording());
    // Advance PAST the MIN_VISIBLE_MS hold before and after the inner end, so
    // the hold cannot be what keeps the flag true. Without this the assertion
    // passes even with ref-counting deleted entirely — the 1200ms floor alone
    // would hold the flag up for the rest of the test.
    act(() => vi.advanceTimersByTime(1300));
    act(() => api.current.endRecording());
    act(() => vi.advanceTimersByTime(1300));
    expect(api.current.isRecording).toBe(true); // outer bracket still open
    act(() => api.current.endRecording());
    act(() => vi.advanceTimersByTime(1300));
    expect(api.current.isRecording).toBe(false);
  });

  it("holds the flag for MIN_VISIBLE_MS so the glow is always seen", () => {
    const api = harness();
    act(() => api.current.beginRecording());
    act(() => api.current.endRecording()); // instant bracket
    expect(api.current.isRecording).toBe(true);
    act(() => vi.advanceTimersByTime(1199));
    expect(api.current.isRecording).toBe(true);
    act(() => vi.advanceTimersByTime(2));
    expect(api.current.isRecording).toBe(false);
  });

  it("drops a step identical to the previous one", () => {
    const api = harness();
    act(() => api.current.beginRecording());
    act(() => api.current.logStep("Opened the Promotions page"));
    act(() => api.current.logStep("Opened the Promotions page"));
    expect(api.current.steps).toHaveLength(1);
  });

  it("ignores steps logged while idle", () => {
    const api = harness();
    act(() => api.current.logStep("Clicked something"));
    expect(api.current.steps).toEqual([]);
  });

  it("clears the feed at the start of a fresh window", () => {
    const api = harness();
    act(() => api.current.beginRecording());
    act(() => api.current.logStep("First demonstration"));
    act(() => api.current.endRecording());
    act(() => vi.advanceTimersByTime(1300));
    act(() => api.current.beginRecording());
    expect(api.current.steps).toEqual([]);
  });

  it("derives the demonstrated code from the last coded step", () => {
    const api = harness();
    act(() => api.current.beginRecording());
    act(() => api.current.logStep("Filed a waiver", "MARGIN-EXC-04"));
    act(() => api.current.logStep("Approved the markdown"));
    expect(api.current.getDemonstratedCode()).toBe("MARGIN-EXC-04");
  });

  // The demo scenario: the operator files a decoy, the write is refused, then
  // they file the real code. Two CODED steps is the only shape that pins the
  // reversal — with one coded step, or with the coded step first, a forward
  // find() passes just as well.
  it("takes the LAST coded step when the operator files twice", () => {
    const api = harness();
    act(() => api.current.beginRecording());
    act(() => api.current.logStep("Filed a waiver", "DECOY-01"));
    act(() => api.current.logStep("Filed a waiver again", "MARGIN-EXC-04"));
    expect(api.current.getDemonstratedCode()).toBe("MARGIN-EXC-04");
  });

  it("faithfully records a decoy code rather than correcting it", () => {
    const api = harness();
    act(() => api.current.beginRecording());
    act(() => api.current.logStep("Filed a waiver", "DECOY-01"));
    expect(api.current.getDemonstratedCode()).toBe("DECOY-01");
  });

  // The shape of banking's teach loop, and the invariant that made it safe to
  // collapse `noteDemonstratedCode` into `logStep`'s code argument. The chat's
  // "Start recording" opens an OUTER bracket that is never closed until the
  // operator clicks "I'm done"; the filing on the dashboard opens and closes an
  // INNER one. Because the ref-count never reaches zero in between, the feed is
  // not cleared and the code filed inside the inner bracket is still derivable
  // at "I'm done" time. The predecessor API stored the code in a ref that
  // outlived every window, so it did not depend on this — losing the outer
  // bracket would now silently strand the code and the saved procedure would
  // carry no exception code at all.
  it("keeps the demonstrated code across a nested bracket in one window", () => {
    const api = harness();
    act(() => api.current.beginRecording()); // "Start recording" (outer)
    act(() => api.current.logStep("Opened Transactions"));
    act(() => api.current.beginRecording()); // the filing (inner)
    act(() => api.current.logStep("Filed the policy exception", "EXC-BOARD"));
    act(() => api.current.endRecording()); // inner closes; count is still 1
    act(() => vi.advanceTimersByTime(1300)); // no hold elapses while count > 0
    act(() => api.current.logStep("Approved the charge"));
    act(() => api.current.endRecording()); // "I'm done" (outer)
    expect(api.current.getDemonstratedCode()).toBe("EXC-BOARD");
  });

  it("returns null when no coded step was logged", () => {
    const api = harness();
    act(() => api.current.beginRecording());
    act(() => api.current.logStep("Opened a page"));
    expect(api.current.getDemonstratedCode()).toBeNull();
  });

  it("renders the waiting copy, then numbered steps", () => {
    const api = harness();
    expect(screen.getByText("Waiting for your first action…")).toBeTruthy();
    act(() => api.current.beginRecording());
    act(() => api.current.logStep("Opened the Promotions page"));
    expect(screen.getByText("Opened the Promotions page")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
  });
});

// The `data-recording` attribute is the ENTIRE contract between this component
// and the `.recording-vignette` CSS now living in the shell's globals.css. The
// CSS only reacts to [data-recording="true"], so if the attribute stops
// flipping the glow silently never appears — exactly what a browser check would
// have caught.
describe("RecordingVignette", () => {
  it("flips data-recording so the shell CSS can react", () => {
    const api = harness();
    const vignette = document.querySelector(".recording-vignette")!;
    expect(vignette.getAttribute("data-recording")).toBe("false");
    act(() => api.current.beginRecording());
    expect(vignette.getAttribute("data-recording")).toBe("true");
    act(() => api.current.endRecording());
    act(() => vi.advanceTimersByTime(1300));
    expect(vignette.getAttribute("data-recording")).toBe("false");
  });
});

describe("useRecording outside a provider", () => {
  it("returns inert no-ops instead of throwing", () => {
    let api: ReturnType<typeof useRecording> | null = null;
    function Bare() {
      api = useRecording();
      return null;
    }
    render(<Bare />);
    expect(api!.isRecording).toBe(false);
    expect(() => api!.logStep("x")).not.toThrow();
    expect(api!.getDemonstratedCode()).toBeNull();
  });
});
