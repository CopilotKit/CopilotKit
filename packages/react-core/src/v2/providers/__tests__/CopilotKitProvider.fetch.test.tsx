import { render, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotKitProvider, useCopilotKit } from "../CopilotKitProvider";
import { useAgent } from "../../hooks/use-agent";
import { transcribeAudio } from "../../lib/transcription-client";
import type { CopilotKitCoreReact } from "../../lib/react-core";

/**
 * The `fetch` prop: the provider hands it to Core, which sends every request
 * through it (Core's own coverage is in
 * `packages/core/src/__tests__/core-fetch-option.test.ts`). React Native's
 * provider takes the same prop with the same contract. What is React-specific,
 * and asserted here, is that the prop reaches Core on mount and on change, and
 * that the requests react-core makes itself (transcription, the provisional
 * agents `useAgent` returns before `/info` lands) use it too.
 */
const RUNTIME_URL = "https://runtime.example/api/copilotkit";

let globalFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  globalFetch = vi.fn(async () => new Response(null, { status: 599 }));
  vi.stubGlobal("fetch", globalFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** A fetch whose `/info` never answers, so the runtime stays "connecting". */
function pendingRuntimeFetch(
  respond: (url: string) => Response | undefined = () => undefined,
) {
  const urls: string[] = [];
  const implementation = vi.fn(
    async (input: RequestInfo | URL): Promise<Response> => {
      const url = urlOf(input);
      urls.push(url);
      const response = respond(url);
      if (response) return response;
      return new Promise<Response>(() => {});
    },
  );
  return { fetch: implementation as unknown as typeof fetch, urls };
}

function createCoreCollector() {
  const instances: CopilotKitCoreReact[] = [];
  function Collector() {
    const { copilotkit } = useCopilotKit();
    instances.push(copilotkit);
    return null;
  }
  return {
    Collector,
    getCore: () => instances[instances.length - 1]!,
  };
}

describe("CopilotKitProvider fetch", () => {
  it("hands the fetch prop to Core, which loads /info through it", async () => {
    const runtime = pendingRuntimeFetch();
    const { Collector, getCore } = createCoreCollector();

    render(
      <CopilotKitProvider
        runtimeUrl={RUNTIME_URL}
        useSingleEndpoint={false}
        fetch={runtime.fetch}
      >
        <Collector />
      </CopilotKitProvider>,
    );

    expect(getCore().fetch).toBe(runtime.fetch);
    await waitFor(() => expect(runtime.urls).toContain(`${RUNTIME_URL}/info`));
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it("adopts a fetch swapped in after mount, and the global one when it is removed", () => {
    const first = pendingRuntimeFetch();
    const second = pendingRuntimeFetch();
    const { Collector, getCore } = createCoreCollector();
    const view = render(
      <CopilotKitProvider runtimeUrl={RUNTIME_URL} fetch={first.fetch}>
        <Collector />
      </CopilotKitProvider>,
    );

    view.rerender(
      <CopilotKitProvider runtimeUrl={RUNTIME_URL} fetch={second.fetch}>
        <Collector />
      </CopilotKitProvider>,
    );
    expect(getCore().fetch).toBe(second.fetch);

    view.rerender(
      <CopilotKitProvider runtimeUrl={RUNTIME_URL}>
        <Collector />
      </CopilotKitProvider>,
    );
    expect(getCore().fetch).toBeUndefined();
  });

  it("leaves Core on the global fetch when the prop is absent", async () => {
    const { Collector, getCore } = createCoreCollector();

    render(
      <CopilotKitProvider runtimeUrl={RUNTIME_URL} useSingleEndpoint={false}>
        <Collector />
      </CopilotKitProvider>,
    );

    expect(getCore().fetch).toBeUndefined();
    await waitFor(() =>
      expect(globalFetch).toHaveBeenCalledWith(
        `${RUNTIME_URL}/info`,
        expect.anything(),
      ),
    );
  });

  it("uploads transcriptions through the fetch prop", async () => {
    const runtime = pendingRuntimeFetch((url) =>
      url.endsWith("/transcribe")
        ? new Response(JSON.stringify({ text: "hello" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        : undefined,
    );
    const { Collector, getCore } = createCoreCollector();
    render(
      <CopilotKitProvider
        runtimeUrl={RUNTIME_URL}
        useSingleEndpoint={false}
        fetch={runtime.fetch}
      >
        <Collector />
      </CopilotKitProvider>,
    );

    const result = await transcribeAudio(
      getCore(),
      new Blob(["audio"], { type: "audio/webm" }),
    );

    expect(result.text).toBe("hello");
    expect(runtime.urls).toContain(`${RUNTIME_URL}/transcribe`);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it("gives the provisional agent useAgent returns before /info lands the fetch prop", async () => {
    const runtime = pendingRuntimeFetch((url) =>
      url.includes("/stop/") ? new Response("{}", { status: 200 }) : undefined,
    );
    const agents: Array<ReturnType<typeof useAgent>["agent"]> = [];
    function Probe() {
      agents.push(useAgent().agent);
      return null;
    }
    render(
      <CopilotKitProvider
        runtimeUrl={RUNTIME_URL}
        useSingleEndpoint={false}
        fetch={runtime.fetch}
      >
        <Probe />
      </CopilotKitProvider>,
    );
    const provisional = agents[agents.length - 1]!;

    provisional.threadId = "thread-1";
    provisional.abortRun();

    await waitFor(() =>
      expect(runtime.urls).toContain(
        `${RUNTIME_URL}/agent/default/stop/thread-1`,
      ),
    );
    expect(globalFetch).not.toHaveBeenCalled();
  });
});
