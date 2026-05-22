import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import React from "react";

import { SandboxErrorBoundary } from "../SandboxErrorBoundary";

function Crashy({ when }: { when: boolean }) {
  if (when) throw new Error("boom in render");
  return <span data-testid="ok">ok</span>;
}

describe("SandboxErrorBoundary", () => {
  it("renders children when no error is thrown", () => {
    const onError = vi.fn();
    render(
      <SandboxErrorBoundary onError={onError}>
        <Crashy when={false} />
      </SandboxErrorBoundary>,
    );
    expect(screen.getByTestId("ok")).toBeTruthy();
    expect(onError).not.toHaveBeenCalled();
  });

  it("calls onError with the normalized payload when child throws", () => {
    const onError = vi.fn();
    // React logs the caught error to console.error in dev — silence the noise.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <SandboxErrorBoundary onError={onError}>
        <Crashy when={true} />
      </SandboxErrorBoundary>,
    );
    errSpy.mockRestore();

    expect(onError).toHaveBeenCalledTimes(1);
    const payload = onError.mock.calls[0]![0] as {
      message: string;
      stack?: string;
    };
    expect(payload.message).toBe("boom in render");
    expect(typeof payload.stack).toBe("string");
  });

  it("renders the provided fallback when child throws", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <SandboxErrorBoundary
        onError={() => {}}
        fallback={<div data-testid="fallback">crashed</div>}
      >
        <Crashy when={true} />
      </SandboxErrorBoundary>,
    );
    errSpy.mockRestore();

    expect(screen.getByTestId("fallback")).toBeTruthy();
  });

  it("swallows errors thrown inside onError so the host isn't broken further", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // The boundary itself should not surface the onError exception — if it did,
    // it would unmount the boundary and throw past the host.
    expect(() =>
      render(
        <SandboxErrorBoundary
          onError={() => {
            throw new Error("onError itself crashed");
          }}
          fallback={<div>fallback</div>}
        >
          <Crashy when={true} />
        </SandboxErrorBoundary>,
      ),
    ).not.toThrow();
    errSpy.mockRestore();
  });
});
