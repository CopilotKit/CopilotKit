import { afterEach, describe, expect, it, vi } from "vitest";
import { createSSRApp } from "vue";
import { mount } from "@vue/test-utils";
import { renderToString } from "vue/server-renderer";
import CopilotKitProvider from "../CopilotKitProvider.vue";

const RUNTIME_URL = "https://runtime.example/api/copilotkit";
const SHAPE_WARNING =
  "renderToolCalls must be a stable array. If you want to dynamically add or remove tools, use `useFrontendTool` instead.";

function stubInfoFetch() {
  const fetchMock = vi.fn(async () => {
    throw new Error("network failure");
  });
  vi.stubGlobal("fetch", fetchMock);
  return () =>
    fetchMock.mock.calls.filter(([url]) => String(url).includes("/info"));
}

/** A tool call renderer shape: only `name` and `agentId` matter here. */
function renderer(name: string) {
  return { name, args: undefined, render: () => null };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CopilotKitProvider (Vue) runtime connection", () => {
  it("does not fetch /info during server-side rendering", async () => {
    const infoCalls = stubInfoFetch();
    await renderToString(
      createSSRApp(CopilotKitProvider, { runtimeUrl: RUNTIME_URL }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(infoCalls()).toHaveLength(0);
  });

  it("fetches /info once the provider mounts", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const infoCalls = stubInfoFetch();
    const wrapper = mount(CopilotKitProvider, {
      props: { runtimeUrl: RUNTIME_URL },
    });
    await vi.waitFor(() => expect(infoCalls().length).toBeGreaterThan(0));
    wrapper.unmount();
  });
});

describe("CopilotKitProvider (Vue) errors", () => {
  it("logs core errors when no onError is given", async () => {
    stubInfoFetch();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapper = mount(CopilotKitProvider, {
      props: { runtimeUrl: RUNTIME_URL },
    });
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        "[CopilotKit] Error (runtime_info_fetch_failed):",
        expect.any(Error),
        expect.anything(),
      ),
    );
    wrapper.unmount();
  });

  it("reports an invalid defaultThrottleMs once, from core", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapper = mount(CopilotKitProvider, {
      props: { runtimeUrl: RUNTIME_URL, defaultThrottleMs: -1 },
    });
    const providerCopies = error.mock.calls.filter(
      ([message]) =>
        typeof message === "string" &&
        message.startsWith("CopilotKitProvider: defaultThrottleMs"),
    );
    const coreReports = error.mock.calls.filter(
      ([message]) =>
        typeof message === "string" &&
        message.startsWith("CopilotKitCore.setDefaultThrottleMs"),
    );
    expect(providerCopies).toEqual([]);
    expect(coreReports.length).toBeGreaterThan(0);
    wrapper.unmount();
  });
});

describe("CopilotKitProvider (Vue) renderToolCalls warning", () => {
  it("warns when the renderToolCalls shape changes", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapper = mount(CopilotKitProvider, {
      props: { runtimeUrl: RUNTIME_URL, renderToolCalls: [renderer("a")] },
    });
    await wrapper.setProps({ renderToolCalls: [renderer("b")] });
    expect(error).toHaveBeenCalledWith(SHAPE_WARNING);
    wrapper.unmount();
  });

  it("does not warn for a new array with the same tools", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapper = mount(CopilotKitProvider, {
      props: { runtimeUrl: RUNTIME_URL, renderToolCalls: [renderer("a")] },
    });
    await wrapper.setProps({ renderToolCalls: [renderer("a")] });
    expect(error).not.toHaveBeenCalledWith(SHAPE_WARNING);
    wrapper.unmount();
  });
});

describe("CopilotKitProvider (Vue) config diagnostics", () => {
  it("warns about a missing runtime config once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const wrapper = mount(CopilotKitProvider, { props: {} });
    await wrapper.setProps({ properties: { tenant: "acme" } });
    const missing = warn.mock.calls.filter(
      ([message]) =>
        message ===
        "Missing required prop: 'runtimeUrl' or 'publicApiKey' or 'publicLicenseKey'",
    );
    expect(missing).toHaveLength(1);
    wrapper.unmount();
  });
});
