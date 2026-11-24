import React from "react";
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Regression test for #8192.
//
// Under Next.js 16 `cacheComponents`, reading an "unstable" value such as
// `crypto.randomUUID()` (what `@copilotkit/shared`'s `randomUUID` uses) during
// render throws ("Next.js encountered the unstable value ... in a Client
// Component"). That aborts the provider's render, so the `connect()` effect
// never runs and `<CopilotChat>` stays stuck (the `/info` discovery request
// never fires and the send button stays disabled).
//
// The fallback thread id must therefore (1) never call `randomUUID` during
// render, and (2) still be distinct for each fresh mount — a render-stable
// `useId()` alone would make two page loads reuse the same thread. The provider
// uses `useId()` as a prerender-safe placeholder and mints the real id in a
// client effect.
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
    mockedRandomUUID.mockReset();
  });

  it("does not read an unstable value during the server render", () => {
    // renderToString mirrors the Next.js prerender: effects do not run, so any
    // render-time `randomUUID()` would surface here.
    mockedRandomUUID.mockImplementation(() => {
      throw new Error("randomUUID() must not be called during render");
    });

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
    let counter = 0;
    mockedRandomUUID.mockImplementation(
      () => `11111111-1111-4111-8111-00000000000${counter++}`,
    );

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
});
