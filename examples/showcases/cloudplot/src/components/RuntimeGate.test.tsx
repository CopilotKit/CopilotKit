// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ cookies: vi.fn() }));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@copilotkit/react-core/v2", () => ({
  CopilotKitProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="provider">{children}</div>
  ),
}));

describe("RuntimeGate", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CLOUDPLOT_ACCESS_CODE", "correct horse");
    vi.stubEnv("CLOUDPLOT_SESSION_SECRET", "session-secret-for-tests");
  });

  afterEach(() => cleanup());

  it("does not mount CopilotKit without an authenticated session", async () => {
    mocks.cookies.mockResolvedValue({ get: vi.fn(() => undefined) });
    const { RuntimeGate } = await import("./RuntimeGate");
    render(await RuntimeGate({ children: <div>workspace</div> }));

    expect(screen.queryByTestId("provider")).toBeNull();
    expect(screen.getByLabelText("Access code")).toBeTruthy();
  });

  it("mounts CopilotKit for an authenticated session", async () => {
    const { createSessionValue, getRuntimeSecurityConfiguration } =
      await import("../lib/runtimeSecurity");
    const configuration = getRuntimeSecurityConfiguration();
    if (configuration.mode !== "protected") throw new Error("bad fixture");
    mocks.cookies.mockResolvedValue({
      get: vi.fn(() => ({ value: createSessionValue(configuration) })),
    });
    const { RuntimeGate } = await import("./RuntimeGate");
    render(await RuntimeGate({ children: <div>workspace</div> }));

    expect(screen.getByTestId("provider")).toBeTruthy();
    expect(screen.getByText("workspace")).toBeTruthy();
  });
});
