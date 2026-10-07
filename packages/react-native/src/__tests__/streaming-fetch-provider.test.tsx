import React from "react";
import { render, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { CopilotKitProviderProps as WebCopilotKitProviderProps } from "@copilotkit/react-core/v2";
import { CopilotKitProvider } from "../CopilotKitProvider";
import type { CopilotKitNativeProviderProps } from "../CopilotKitProvider";

/**
 * The React Native provider against the REAL Core on a bare React Native
 * platform: React Native's own fetch (whatwg-fetch, `polyfill: true`) cannot
 * stream, so the provider gives Core CopilotKit's XHR-based streaming fetch,
 * scoped to Core. The app's global fetch must stay untouched.
 */

const RUNTIME_URL = "https://runtime.example/api/copilotkit";

interface ServerReply {
  status: number;
  body: string;
  contentType?: string;
}

/** An XHR that answers like a server, through React Native's callback order. */
class ServerXHR {
  static instances: ServerXHR[] = [];
  static reply: (method: string, url: string) => ServerReply = () => ({
    status: 404,
    body: "",
  });

  method = "";
  url = "";
  readyState = 0;
  status = 0;
  statusText = "";
  responseText = "";
  responseType = "";
  timeout = 0;
  // React Native's XMLHttpRequest defaults this to true.
  withCredentials = true;
  private responseHeaders = "";
  onreadystatechange: (() => void) | null = null;
  onprogress: (() => void) | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;

  constructor() {
    ServerXHR.instances.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader() {}

  getAllResponseHeaders() {
    return this.responseHeaders;
  }

  abort() {}

  send() {
    const reply = ServerXHR.reply(this.method, this.url);
    setTimeout(() => {
      this.responseHeaders = `content-type: ${reply.contentType ?? "application/json"}\r\n`;
      this.status = reply.status;
      this.readyState = 2;
      this.onreadystatechange?.();
      this.responseText = reply.body;
      this.readyState = 3;
      this.onprogress?.();
      this.readyState = 4;
      this.onreadystatechange?.();
      this.onload?.();
    }, 0);
  }
}

const g = globalThis as unknown as Record<string, unknown>;
let saved: Record<string, unknown>;
let reactNativeFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  saved = { fetch: g.fetch, XMLHttpRequest: g.XMLHttpRequest };
  reactNativeFetch = Object.assign(vi.fn(), { polyfill: true });
  g.fetch = reactNativeFetch;
  g.XMLHttpRequest = ServerXHR;
  ServerXHR.instances = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) g[key] = value;
  vi.restoreAllMocks();
});

const runtimeInfo = JSON.stringify({
  version: "1.0.0",
  mode: "sse",
  agents: { default: { description: "Default agent" } },
});

describe("CopilotKitProvider on bare React Native (real Core)", () => {
  it("sends Core's requests through the scoped streaming fetch with the provider's credentials, leaving the app's fetch alone", async () => {
    ServerXHR.reply = (method, url) =>
      method === "GET" && url === `${RUNTIME_URL}/info`
        ? { status: 200, body: runtimeInfo }
        : { status: 404, body: "" };

    render(
      <CopilotKitProvider
        runtimeUrl={RUNTIME_URL}
        useSingleEndpoint={false}
        credentials="omit"
      >
        <></>
      </CopilotKitProvider>,
    );

    await waitFor(() => expect(ServerXHR.instances.length).toBeGreaterThan(0));
    const info = ServerXHR.instances[0]!;
    expect(info.method).toBe("GET");
    expect(info.url).toBe(`${RUNTIME_URL}/info`);
    expect(info.withCredentials).toBe(false);
    expect(reactNativeFetch).not.toHaveBeenCalled();
    expect(g.fetch).toBe(reactNativeFetch);
  });

  it("keeps the runtime's explanation of a failed /info, which Core reads from response.clone()", async () => {
    ServerXHR.reply = () => ({
      status: 404,
      body: JSON.stringify({
        message: "This runtime serves the single-route transport.",
      }),
    });
    const onError = vi.fn();

    render(
      <CopilotKitProvider
        runtimeUrl={RUNTIME_URL}
        useSingleEndpoint={false}
        onError={onError}
      >
        <></>
      </CopilotKitProvider>,
    );

    await waitFor(() => expect(onError).toHaveBeenCalled());
    const { error, code } = onError.mock.calls[0]![0];
    expect(code).toBe("runtime_info_fetch_failed");
    expect(error.message).toBe(
      "Runtime info request failed with status 404: This runtime serves the single-route transport.",
    );
  });
});

describe("fetch prop parity with the web CopilotKitProvider", () => {
  it("has the same type on both providers", () => {
    // `check-types` fails here if either side drifts.
    type Equal<A, B> =
      (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
        ? true
        : false;
    const sameContract: Equal<
      CopilotKitNativeProviderProps["fetch"],
      WebCopilotKitProviderProps["fetch"]
    > = true;
    expect(sameContract).toBe(true);
  });
});
