import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import React from "react";
import { createA2UIRecoveryRenderer } from "../a2ui/A2UIRecoveryRenderer";

function renderRecovery(
  content: any,
  options?: Parameters<typeof createA2UIRecoveryRenderer>[0],
) {
  const renderer = createA2UIRecoveryRenderer(options);
  const R = renderer.render as React.FC<any>;
  // @testing-library/react's render already wraps in act().
  return render(
    <R
      content={content}
      agent={undefined}
      message={{} as any}
      activityType="a2ui_recovery"
    />,
  ).container;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createA2UIRecoveryRenderer", () => {
  it("registers for the a2ui_recovery activity type", () => {
    expect(createA2UIRecoveryRenderer().activityType).toBe("a2ui_recovery");
  });

  it("renders nothing for a resolved status (the surface renderer shows the UI)", () => {
    const container = renderRecovery({ status: "resolved" });
    expect(container.textContent).toBe("");
  });

  it("does NOT flash the retrying status before the delay on a fast first retry", () => {
    vi.useFakeTimers();
    const container = renderRecovery(
      { status: "retrying", attempt: 1 },
      { showAfterMs: 2000 },
    );
    expect(container.textContent).not.toContain("Retrying");
  });

  it("shows the retrying status once the delay elapses", () => {
    vi.useFakeTimers();
    const container = renderRecovery(
      { status: "retrying", attempt: 1 },
      { showAfterMs: 2000 },
    );
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    expect(container.textContent).toContain("Retrying UI generation");
  });

  it("shows the retrying status immediately once attempts cross the threshold", () => {
    vi.useFakeTimers();
    const container = renderRecovery(
      { status: "retrying", attempt: 2 },
      { showAfterMs: 999999, showAfterAttempts: 2 },
    );
    expect(container.textContent).toContain("Retrying UI generation");
  });

  it("renders a clean hard-failure message with expandable developer detail", () => {
    const container = renderRecovery({
      status: "failed",
      error: "Failed to generate valid A2UI after 3 attempt(s)",
      attempts: [
        { attempt: 1, ok: false, errors: [{ code: "missing_required_prop" }] },
      ],
    });
    // Clean, user-facing message (no raw error dump in the headline)
    expect(container.textContent).toContain("Couldn't generate");
    // Developer detail present but tucked into a <details> (collapsed by default)
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(container.textContent).toContain("missing_required_prop");
  });

  it("hides developer detail entirely when debugExposure is 'hidden'", () => {
    const container = renderRecovery(
      {
        status: "failed",
        error: "boom",
        attempts: [{ attempt: 1, ok: false }],
      },
      { debugExposure: "hidden" },
    );
    expect(container.textContent).toContain("Couldn't generate");
    expect(container.querySelector("details")).toBeNull();
  });

  it("lets server-stamped content.debugExposure override the client option (OSS-162)", () => {
    // The A2UI middleware stamps recovery.debugExposure onto the activity so the
    // server (covering Python + TS agents alike) can drive exposure end-to-end.
    // It must win over the client-side factory option.
    const container = renderRecovery(
      {
        status: "failed",
        error: "boom",
        attempts: [{ attempt: 1, ok: false }],
        debugExposure: "hidden",
      },
      { debugExposure: "verbose" },
    );
    expect(container.textContent).toContain("Couldn't generate");
    expect(container.querySelector("details")).toBeNull();
  });
});
