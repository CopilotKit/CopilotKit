import React from "react";
import { renderHook } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CopilotKit } from "../copilotkit";
import { useCopilotKit } from "../../../v2/providers/CopilotKitProvider";
import type { CopilotKitProps } from "../copilotkit-props";

type V1Props = CopilotKitProps & {
  agents__unsafe_dev_only?: Record<string, unknown>;
};
const CopilotKitAny = CopilotKit as unknown as React.FC<V1Props>;

/**
 * Verifies that the v1 <CopilotKit> wrapper correctly maps transport props
 * through to the underlying v2 CopilotKitProvider. After the deprecation of
 * useSingleEndpoint, the v1 wrapper no longer defaults to single-endpoint
 * transport — it defaults to REST like v2.
 */
describe("v1 <CopilotKit> wrapper → transport default", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("defaults to 'rest' transport when no transport prop is set", () => {
    const { result } = renderHook(() => useCopilotKit(), {
      wrapper: ({ children }) => (
        <CopilotKitAny publicApiKey="test-key">{children}</CopilotKitAny>
      ),
    });

    expect(result.current.copilotkit.runtimeTransport).toBe("rest");
  });

  it("maps useLegacyRuntime=true to 'single' transport", () => {
    const { result } = renderHook(() => useCopilotKit(), {
      wrapper: ({ children }) => (
        <CopilotKitAny publicApiKey="test-key" useLegacyRuntime={true}>
          {children}
        </CopilotKitAny>
      ),
    });

    expect(result.current.copilotkit.runtimeTransport).toBe("single");
  });

  it("maps deprecated useSingleEndpoint=true to 'single' transport", () => {
    const { result } = renderHook(() => useCopilotKit(), {
      wrapper: ({ children }) => (
        <CopilotKitAny publicApiKey="test-key" useSingleEndpoint={true}>
          {children}
        </CopilotKitAny>
      ),
    });

    expect(result.current.copilotkit.runtimeTransport).toBe("single");
  });
});
