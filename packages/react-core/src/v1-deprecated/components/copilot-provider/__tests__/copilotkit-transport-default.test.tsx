import { renderHook } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCopilotKit } from "../../../../v2";
import { CopilotKit } from "../copilotkit";

/**
 * The compatibility `<CopilotKit>` wrapper is re-exported from
 * `@copilotkit/react-core/v2`, so it is the provider most integrations reach
 * for. It used to pin `useSingleEndpoint` to `true`, which overrode the core's
 * `"auto"` negotiation and made every first request 404 against a multi-route
 * runtime — the default handler mode. See OSS-888.
 *
 * Omitting the prop must therefore resolve to `"auto"`, which probes
 * `GET /info` and falls back to the single-route envelope, so the wrapper works
 * against either handler mode. An explicit prop must still win.
 */
describe("CopilotKit (compat wrapper) transport default", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  function wrapperWith(props: { useSingleEndpoint?: boolean }) {
    return ({ children }: { children?: React.ReactNode }) => (
      <CopilotKit runtimeUrl="/api/copilotkit" {...props}>
        {children}
      </CopilotKit>
    );
  }

  it("resolves an omitted useSingleEndpoint to 'auto' transport", () => {
    const { result } = renderHook(() => useCopilotKit(), {
      wrapper: wrapperWith({}),
    });

    expect(result.current.copilotkit.runtimeTransport).toBe("auto");
  });

  it("still maps an explicit useSingleEndpoint={true} to 'single'", () => {
    const { result } = renderHook(() => useCopilotKit(), {
      wrapper: wrapperWith({ useSingleEndpoint: true }),
    });

    expect(result.current.copilotkit.runtimeTransport).toBe("single");
  });

  it("still maps an explicit useSingleEndpoint={false} to 'rest'", () => {
    const { result } = renderHook(() => useCopilotKit(), {
      wrapper: wrapperWith({ useSingleEndpoint: false }),
    });

    expect(result.current.copilotkit.runtimeTransport).toBe("rest");
  });
});
