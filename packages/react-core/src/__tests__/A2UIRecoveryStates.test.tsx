import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import React from "react";
import type { Theme } from "@copilotkit/a2ui-renderer";
import { createA2UIMessageRenderer } from "../a2ui/A2UIMessageRenderer";
import type { A2UIRecoveryRendererOptions } from "../a2ui/A2UIRecoveryStates";

vi.mock("../providers", () => ({
  useCopilotKit: () => ({ copilotkit: {} }),
}));

afterEach(() => {
  vi.useRealTimers();
});

const Loading = () => <div data-testid="custom-loading" />;

/** Renders the lifecycle state for one activity content snapshot. */
function renderLifecycle(
  content: Record<string, unknown>,
  options: {
    recovery?: A2UIRecoveryRendererOptions;
    loadingComponent?: React.ComponentType;
  } = {},
) {
  const RenderComponent = createA2UIMessageRenderer({
    theme: {} as Theme,
    ...options,
  }).render as React.FC<{ content: unknown; agent: undefined }>;
  return render(<RenderComponent content={content} agent={undefined} />);
}

describe("A2UI lifecycle states (OSS-162)", () => {
  describe("building", () => {
    it("shows the 'Building interface' skeleton", () => {
      const { container } = renderLifecycle({ status: "building" });
      expect(container.textContent).toContain("Building interface");
    });

    it("shows a live token count when progressTokens is present", () => {
      const { container } = renderLifecycle({
        status: "building",
        progressTokens: 97,
      });
      expect(container.textContent).toContain("Building interface");
      expect(container.textContent).toContain("97 tokens");
    });

    it("omits the token count when progressTokens is zero", () => {
      const { container } = renderLifecycle({
        status: "building",
        progressTokens: 0,
      });
      expect(container.textContent).not.toContain("tokens");
    });

    it("shows the host's loading component instead of the skeleton", () => {
      const { queryByTestId, container } = renderLifecycle(
        { status: "building" },
        { loadingComponent: Loading },
      );
      expect(queryByTestId("custom-loading")).not.toBeNull();
      expect(container.textContent).not.toContain("Building interface");
    });
  });

  describe("retrying (threshold-gated label)", () => {
    const firstRetry = { status: "retrying", attempt: 1, maxAttempts: 3 };

    it("stays the generic building skeleton before the delay on a fast first retry", () => {
      vi.useFakeTimers();
      const { container } = renderLifecycle(firstRetry);
      expect(container.textContent).toContain("Building interface");
      expect(container.textContent).not.toContain("Retrying");
    });

    it("reveals 'Retrying generation… (N/M attempts)' once the delay elapses", () => {
      vi.useFakeTimers();
      const { container } = renderLifecycle(firstRetry, {
        recovery: { showAfterMs: 2000 },
      });
      act(() => {
        vi.advanceTimersByTime(2100);
      });
      expect(container.textContent).toContain("Retrying generation");
      expect(container.textContent).toContain("(1/3 attempts)");
    });

    it("reveals the retry label immediately once attempts cross the threshold", () => {
      const { container } = renderLifecycle(
        { status: "retrying", attempt: 2, maxAttempts: 3 },
        { recovery: { showAfterMs: 999999 } },
      );
      expect(container.textContent).toContain("Retrying generation");
      expect(container.textContent).toContain("(2/3 attempts)");
    });

    it("shows validation-issue detail once revealed, unless debugExposure is 'hidden'", () => {
      const retry = {
        status: "retrying",
        attempt: 2,
        maxAttempts: 3,
        errors: [{ code: "missing_required_prop" }],
      };
      const shown = renderLifecycle(retry);
      expect(shown.container.querySelector("details")).not.toBeNull();
      expect(shown.container.textContent).toContain("missing_required_prop");

      const hidden = renderLifecycle(retry, {
        recovery: { debugExposure: "hidden" },
      });
      expect(hidden.container.querySelector("details")).toBeNull();
    });
  });

  describe("failed (replaces the skeleton in place)", () => {
    it("renders a clean message with expandable developer detail (collapsed default)", () => {
      const { container } = renderLifecycle({
        status: "failed",
        error: "Failed to generate valid A2UI after 3 attempt(s)",
        attempts: [
          {
            attempt: 1,
            ok: false,
            errors: [{ code: "missing_required_prop" }],
          },
        ],
      });
      expect(container.textContent).toContain("Couldn't generate");
      const details = container.querySelector("details");
      expect(details).not.toBeNull();
      expect(details!.hasAttribute("open")).toBe(false);
      expect(container.textContent).toContain("missing_required_prop");
    });

    it("hides developer detail entirely when debugExposure is 'hidden'", () => {
      const { container } = renderLifecycle(
        { status: "failed", error: "boom", attempts: [{ attempt: 1 }] },
        { recovery: { debugExposure: "hidden" } },
      );
      expect(container.textContent).toContain("Couldn't generate");
      expect(container.querySelector("details")).toBeNull();
    });

    it("opens the developer detail when the server stamps 'verbose'", () => {
      const { container } = renderLifecycle(
        { status: "failed", error: "boom", debugExposure: "verbose" },
        { recovery: { debugExposure: "hidden" } },
      );
      expect(container.querySelector("details")?.hasAttribute("open")).toBe(
        true,
      );
    });

    it("shows the failure card instead of the host's loading component", () => {
      const { queryByTestId, container } = renderLifecycle(
        { status: "failed" },
        { loadingComponent: Loading },
      );
      expect(queryByTestId("custom-loading")).toBeNull();
      expect(container.textContent).toContain("Couldn't generate");
    });
  });
});
