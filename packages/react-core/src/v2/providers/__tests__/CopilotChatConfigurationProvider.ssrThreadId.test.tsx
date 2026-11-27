import React from "react";
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Regression test for #8192.
//
// Under Next.js 16 `cacheComponents`, reading an "unstable" value such as
// `crypto.randomUUID()` (what `@copilotkit/shared`'s `randomUUID` uses) during
// the prerender throws ("Next.js encountered the unstable value ... in a Client
// Component"). That aborts the provider's render, so the `connect()` effect
// never runs and `<CopilotChat>` stays stuck (no `/info` discovery, send button
// disabled).
//
// The fallback thread id must therefore:
//   1. never call `randomUUID` during the server render (#8192);
//   2. be distinct for each fresh mount — a render-stable `useId()` alone would
//      make two page loads reuse the same thread;
//   3. stay stable for the lifetime of a mount — a mid-session change would read
//      as a thread switch and tear down existing agent state.
//
// We wrap the real `randomUUID` so each test can swap its behaviour.
vi.mock("@copilotkit/shared", async importActual => {
  const actual = await importActual<typeof import("@copilotkit/shared")>();
  return { ...actual, randomUUID: vi.fn(actual.randomUUID) };
});

import { randomUUID } from "@copilotkit/shared";
import {
  CopilotChatConfigurationProvider,
  useCopilotChatConfiguration,
} from "../CopilotChatConfigurationProvider";

const mockedRandomUUID = vi.mocked(randomUUID);

function ThreadIdProbe() {
  const config = useCopilotChatConfiguration();
  return <div data-testid="threadId">{config?.threadId ?? ""}</div>;
}

describe("CopilotChatConfigurationProvider — SSR-safe, unique fallback thread id (#8192)", () => {
  beforeEach(() => {
    // Deterministic, distinct ids by default so uniqueness assertions are stable.
    let counter = 0;
    mockedRandomUUID.mockReset();
    mockedRandomUUID.mockImplementation(
      () => `11111111-1111-4111-8111-00000000000${counter++}`,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not read an unstable value during the server render (#8192)", () => {
    mockedRandomUUID.mockImplementation(() => {
      throw new Error("randomUUID() must not be called during render");
    });
    // Simulate the Next.js prerender: no `window`, and effects do not run.
    vi.stubGlobal("window", undefined);

    let html = "";
    expect(() => {
      html = renderToString(
        <CopilotChatConfigurationProvider>
          <ThreadIdProbe />
        </CopilotChatConfigurationProvider>,
      );
    }).not.toThrow();

    expect(mockedRandomUUID).not.toHaveBeenCalled();
    // A stable placeholder id is still provided to consumers during SSR.
    expect(html).toContain('data-testid="threadId"');
  });

  it("mints a distinct fallback threadId for each fresh mount", () => {
    const first = render(
      <CopilotChatConfigurationProvider>
        <ThreadIdProbe />
      </CopilotChatConfigurationProvider>,
    );
    const firstId = screen.getByTestId("threadId").textContent;
    first.unmount();

    render(
      <CopilotChatConfigurationProvider>
        <ThreadIdProbe />
      </CopilotChatConfigurationProvider>,
    );
    const secondId = screen.getByTestId("threadId").textContent;

    expect(firstId).toBeTruthy();
    expect(secondId).toBeTruthy();
    expect(firstId).not.toBe(secondId);
  });

  it("keeps the fallback threadId stable across re-renders (no mid-session switch)", () => {
    const { rerender } = render(
      <CopilotChatConfigurationProvider>
        <ThreadIdProbe />
      </CopilotChatConfigurationProvider>,
    );
    const firstId = screen.getByTestId("threadId").textContent;

    rerender(
      <CopilotChatConfigurationProvider>
        <ThreadIdProbe />
      </CopilotChatConfigurationProvider>,
    );
    const afterRerenderId = screen.getByTestId("threadId").textContent;

    expect(firstId).toBeTruthy();
    expect(afterRerenderId).toBe(firstId);
  });
});
