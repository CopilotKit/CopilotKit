import React from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "@copilotkit/shared";
import type * as SharedModule from "@copilotkit/shared";
import { CopilotKitProvider } from "../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../providers/CopilotChatConfigurationProvider";
import { CopilotSidebar } from "../components/chat/CopilotSidebar";
import { CopilotKit } from "../../v1-deprecated";

// Next.js with `cacheComponents` prerenders Client Components and fails the
// build when render reads the clock or a random value (`Date.now()`,
// `Math.random()`, `crypto.randomUUID()`). The quickstart tree must render on
// the server without reading any of them.
vi.mock("@copilotkit/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof SharedModule>();
  return { ...actual, randomUUID: vi.fn(actual.randomUUID) };
});

function spyOnUnstableValues() {
  vi.mocked(randomUUID).mockClear();
  return {
    "Date.now": vi.spyOn(Date, "now"),
    "Math.random": vi.spyOn(Math, "random"),
    "crypto.randomUUID": vi.spyOn(globalThis.crypto, "randomUUID"),
    randomUUID: vi.mocked(randomUUID),
  };
}

function callsOf(spies: ReturnType<typeof spyOnUnstableValues>) {
  return Object.fromEntries(
    Object.entries(spies).map(([name, spy]) => [name, spy.mock.calls.length]),
  );
}

describe("server render reads no clock or random value", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("for the quickstart provider and sidebar", () => {
    vi.stubGlobal("window", undefined);
    const spies = spyOnUnstableValues();

    const html = renderToString(
      <CopilotKitProvider runtimeUrl="/api/copilotkit">
        <CopilotSidebar />
      </CopilotKitProvider>,
    );

    expect(html).not.toBe("");
    expect(callsOf(spies)).toEqual({
      "Date.now": 0,
      "Math.random": 0,
      "crypto.randomUUID": 0,
      randomUUID: 0,
    });
  });

  it("for a standalone chat configuration provider", () => {
    vi.stubGlobal("window", undefined);
    const spies = spyOnUnstableValues();

    renderToString(
      <CopilotChatConfigurationProvider>
        <div />
      </CopilotChatConfigurationProvider>,
    );

    expect(callsOf(spies).randomUUID).toBe(0);
  });

  it("for the v1 CopilotKit provider", () => {
    vi.stubGlobal("window", undefined);
    const spies = spyOnUnstableValues();

    renderToString(
      <CopilotKit runtimeUrl="/api/copilotkit">
        <div />
      </CopilotKit>,
    );

    expect(callsOf(spies)).toEqual({
      "Date.now": 0,
      "Math.random": 0,
      "crypto.randomUUID": 0,
      randomUUID: 0,
    });
  });

  it("still mints a random Thread ID in the browser", () => {
    const spies = spyOnUnstableValues();

    renderToString(
      <CopilotChatConfigurationProvider>
        <div />
      </CopilotChatConfigurationProvider>,
    );

    expect(spies.randomUUID).toHaveBeenCalled();
  });
});
