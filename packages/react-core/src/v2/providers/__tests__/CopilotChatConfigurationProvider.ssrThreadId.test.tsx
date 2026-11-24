import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// Regression test for #8192.
//
// Under Next.js 16 `cacheComponents`, reading an "unstable" value such as
// `crypto.randomUUID()` (what `@copilotkit/shared`'s `randomUUID` uses) during
// render throws: "Next.js encountered the unstable value ... in a Client
// Component". That aborts the provider's render, so the `connect()` effect never
// runs and `<CopilotChat>` stays stuck (the `/info` discovery request never
// fires, the send button stays disabled).
//
// The auto-generated fallback thread id must therefore be derived WITHOUT calling
// `randomUUID` at render time (we use React's SSR-safe `useId`). We model the
// prerender constraint here by making `randomUUID` throw if it is ever evaluated
// during render.
vi.mock("@copilotkit/shared", async (importActual) => {
  const actual = await importActual<typeof import("@copilotkit/shared")>();
  return {
    ...actual,
    randomUUID: vi.fn(() => {
      throw new Error(
        "randomUUID() must not be called during render (Next.js cacheComponents rejects unstable values)",
      );
    }),
  };
});

import {
  CopilotChatConfigurationProvider,
  useCopilotChatConfiguration,
} from "../CopilotChatConfigurationProvider";

function ThreadIdProbe() {
  const config = useCopilotChatConfiguration();
  return <div data-testid="threadId">{config?.threadId ?? ""}</div>;
}

describe("CopilotChatConfigurationProvider — SSR-safe fallback thread id (#8192)", () => {
  it("auto-generates a fallback threadId without calling randomUUID during render", () => {
    expect(() =>
      render(
        <CopilotChatConfigurationProvider>
          <ThreadIdProbe />
        </CopilotChatConfigurationProvider>,
      ),
    ).not.toThrow();

    // A non-empty, stable fallback id is still provided to consumers.
    const threadId = screen.getByTestId("threadId").textContent;
    expect(threadId).toBeTruthy();
  });

  it("keeps the generated fallback threadId stable across re-renders", () => {
    const { rerender } = render(
      <CopilotChatConfigurationProvider>
        <ThreadIdProbe />
      </CopilotChatConfigurationProvider>,
    );
    const first = screen.getByTestId("threadId").textContent;

    rerender(
      <CopilotChatConfigurationProvider>
        <ThreadIdProbe />
      </CopilotChatConfigurationProvider>,
    );
    const second = screen.getByTestId("threadId").textContent;

    expect(second).toBe(first);
  });
});
