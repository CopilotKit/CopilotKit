import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import React from "react";
import {
  A2UIBuildingState,
  A2UIRetryingState,
  A2UIRecoveryFailure,
  resolveDebugExposure,
} from "../a2ui/A2UIRecoveryStates";

afterEach(() => {
  vi.useRealTimers();
});

describe("A2UI lifecycle states (OSS-162)", () => {
  describe("building", () => {
    it("shows the 'Building interface' skeleton", () => {
      const { container } = render(
        <A2UIBuildingState content={{ status: "building" }} />,
      );
      expect(container.textContent).toContain("Building interface");
    });

    it("shows a live token count when progressTokens is present", () => {
      const { container } = render(
        <A2UIBuildingState
          content={{ status: "building", progressTokens: 97 }}
        />,
      );
      expect(container.textContent).toContain("Building interface");
      expect(container.textContent).toContain("97 tokens");
    });

    it("omits the token count when progressTokens is absent or zero", () => {
      const { container } = render(
        <A2UIBuildingState
          content={{ status: "building", progressTokens: 0 }}
        />,
      );
      expect(container.textContent).not.toContain("tokens");
    });
  });

  describe("retrying (threshold-gated label)", () => {
    it("stays the generic building skeleton before the delay on a fast first retry", () => {
      vi.useFakeTimers();
      const { container } = render(
        <A2UIRetryingState
          content={{ status: "retrying", attempt: 1, maxAttempts: 3 }}
          showAfterMs={2000}
          showAfterAttempts={2}
          debugExposure="collapsed"
        />,
      );
      expect(container.textContent).toContain("Building interface");
      expect(container.textContent).not.toContain("Retrying");
    });

    it("reveals 'Retrying generation… (N/M attempts)' once the delay elapses", () => {
      vi.useFakeTimers();
      const { container } = render(
        <A2UIRetryingState
          content={{ status: "retrying", attempt: 1, maxAttempts: 3 }}
          showAfterMs={2000}
          showAfterAttempts={2}
          debugExposure="collapsed"
        />,
      );
      act(() => {
        vi.advanceTimersByTime(2100);
      });
      expect(container.textContent).toContain("Retrying generation");
      expect(container.textContent).toContain("(1/3 attempts)");
    });

    it("reveals the retry label immediately once attempts cross the threshold", () => {
      vi.useFakeTimers();
      const { container } = render(
        <A2UIRetryingState
          content={{ status: "retrying", attempt: 2, maxAttempts: 3 }}
          showAfterMs={999999}
          showAfterAttempts={2}
          debugExposure="collapsed"
        />,
      );
      expect(container.textContent).toContain("Retrying generation");
      expect(container.textContent).toContain("(2/3 attempts)");
    });

    it("shows validation-issue detail once revealed, unless debugExposure is 'hidden'", () => {
      const shown = render(
        <A2UIRetryingState
          content={{
            status: "retrying",
            attempt: 2,
            maxAttempts: 3,
            errors: [{ code: "missing_required_prop" }],
          }}
          showAfterMs={0}
          showAfterAttempts={1}
          debugExposure="collapsed"
        />,
      );
      expect(shown.container.querySelector("details")).not.toBeNull();
      expect(shown.container.textContent).toContain("missing_required_prop");

      const hidden = render(
        <A2UIRetryingState
          content={{
            status: "retrying",
            attempt: 2,
            maxAttempts: 3,
            errors: [{ code: "missing_required_prop" }],
          }}
          showAfterMs={0}
          showAfterAttempts={1}
          debugExposure="hidden"
        />,
      );
      expect(hidden.container.querySelector("details")).toBeNull();
    });
  });

  describe("failed (replaces the skeleton in place)", () => {
    it("renders a clean message with expandable developer detail (collapsed default)", () => {
      const { container } = render(
        <A2UIRecoveryFailure
          content={{
            status: "failed",
            error: "Failed to generate valid A2UI after 3 attempt(s)",
            attempts: [
              {
                attempt: 1,
                ok: false,
                errors: [{ code: "missing_required_prop" }],
              },
            ],
          }}
          debugExposure="collapsed"
        />,
      );
      expect(container.textContent).toContain("Couldn't generate");
      const details = container.querySelector("details");
      expect(details).not.toBeNull();
      expect(details!.hasAttribute("open")).toBe(false);
      expect(container.textContent).toContain("missing_required_prop");
    });

    it("hides developer detail entirely when debugExposure is 'hidden'", () => {
      const { container } = render(
        <A2UIRecoveryFailure
          content={{
            status: "failed",
            error: "boom",
            attempts: [{ attempt: 1, ok: false }],
          }}
          debugExposure="hidden"
        />,
      );
      expect(container.textContent).toContain("Couldn't generate");
      expect(container.querySelector("details")).toBeNull();
    });

    it("opens the developer detail when debugExposure is 'verbose'", () => {
      const { container } = render(
        <A2UIRecoveryFailure
          content={{ status: "failed", error: "boom", attempts: [] }}
          debugExposure="verbose"
        />,
      );
      const details = container.querySelector("details");
      expect(details).not.toBeNull();
      expect(details!.hasAttribute("open")).toBe(true);
    });
  });

  describe("resolveDebugExposure precedence", () => {
    it("server-stamped content.debugExposure wins over the client option", () => {
      expect(resolveDebugExposure({ debugExposure: "hidden" }, "verbose")).toBe(
        "hidden",
      );
    });
    it("falls back to the client option when content has none", () => {
      expect(resolveDebugExposure({}, "verbose")).toBe("verbose");
    });
    it("falls back to the resolved default when neither is set", () => {
      expect(resolveDebugExposure(undefined, "collapsed")).toBe("collapsed");
    });
  });
});
