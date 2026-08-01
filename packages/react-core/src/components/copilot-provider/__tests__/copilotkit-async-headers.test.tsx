import React, { useEffect } from "react";
import { render, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpAgent } from "@ag-ui/client";
import { CopilotKit } from "../copilotkit";
import { useCopilotContext } from "../../../context/copilot-context";
import type { HeaderRecord } from "../../../v2/hooks/use-resolved-headers";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function HeaderProbe({
  onHeaders,
}: {
  onHeaders: (headers: HeaderRecord) => void;
}) {
  const { copilotApiConfig } = useCopilotContext();
  useEffect(() => {
    onHeaders({ ...copilotApiConfig.headers });
  }, [copilotApiConfig, onHeaders]);
  return null;
}

function ConfigProbe({
  onConfig,
}: {
  onConfig: (config: { publicApiKey?: string }) => void;
}) {
  const { copilotApiConfig } = useCopilotContext();
  useEffect(() => {
    onConfig(copilotApiConfig);
  }, [copilotApiConfig, onConfig]);
  return null;
}

describe("v1 CopilotKit async headers", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: "1.0.0", agents: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it("reads one settled core header record instead of resolving the source again", async () => {
    const pending = deferred<HeaderRecord>();
    const builder = vi.fn(() => pending.promise);
    const observed: HeaderRecord[] = [];
    const agent = new HttpAgent({ url: "https://agent.example" });

    render(
      <CopilotKit
        runtimeUrl="https://runtime.example/rest"
        headers={builder}
        agent="default"
        agents__unsafe_dev_only={{ default: agent }}
      >
        <HeaderProbe onHeaders={(headers) => observed.push(headers)} />
      </CopilotKit>,
    );

    act(() => pending.resolve({ Authorization: "Bearer v1" }));
    await waitFor(() =>
      expect(observed).toContainEqual({ Authorization: "Bearer v1" }),
    );
    expect(builder).toHaveBeenCalled();
  });

  it("keeps one explicit cloud key in the v1 settled header record", async () => {
    const observed: HeaderRecord[] = [];
    const configs: { publicApiKey?: string }[] = [];
    const agent = new HttpAgent({ url: "https://agent.example" });

    render(
      <CopilotKit
        runtimeUrl="https://runtime.example/rest"
        publicApiKey="api-key"
        publicLicenseKey="license-key"
        headers={{
          "X-Mine": "mine",
          "x-copilotcloud-public-api-key": "explicit-key",
        }}
        agent="default"
        agents__unsafe_dev_only={{ default: agent }}
      >
        <HeaderProbe onHeaders={(headers) => observed.push(headers)} />
        <ConfigProbe onConfig={(config) => configs.push(config)} />
      </CopilotKit>,
    );

    await waitFor(() =>
      expect(observed).toContainEqual(
        expect.objectContaining({
          "X-Mine": "mine",
          "x-copilotcloud-public-api-key": "explicit-key",
        }),
      ),
    );
    await waitFor(() => expect(configs.at(-1)?.publicApiKey).toBe("api-key"));
    expect(observed.at(-1)?.["x-copilotcloud-public-api-key"]).toBe(
      "explicit-key",
    );
  });

  it("routes local header failures to the v1 onError surface", async () => {
    const pending = deferred<HeaderRecord>();
    const onError = vi.fn();
    const agent = new HttpAgent({ url: "https://agent.example" });

    render(
      <CopilotKit
        runtimeUrl="https://runtime.example/rest"
        headers={() => pending.promise}
        onError={onError}
        agent="default"
        agents__unsafe_dev_only={{ default: agent }}
      >
        child
      </CopilotKit>,
    );

    act(() => pending.reject(new Error("header service unavailable")));
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0]?.[0]).toMatchObject({
      type: "error",
      context: {
        source: "headers",
        request: { operation: "runtime_info_fetch_failed" },
      },
    });
  });
});
