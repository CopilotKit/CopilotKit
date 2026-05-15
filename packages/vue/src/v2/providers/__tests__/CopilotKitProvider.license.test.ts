import { cleanup, render, waitFor } from "@testing-library/vue";
import { defineComponent, h } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CopilotKitProvider from "../CopilotKitProvider.vue";

/**
 * These tests verify that the license banner is driven by the server-reported
 * licenseStatus field in the /info response — not by client-side token
 * verification. Mirrors React's `CopilotKitProvider.license.test.tsx`.
 */

function mockFetchWithLicenseStatus(licenseStatus?: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({
      version: "1.0.0",
      agents: {},
      audioFileTranscriptionEnabled: false,
      mode: "intelligence",
      licenseStatus,
    }),
  });
}

const Child = defineComponent({
  setup() {
    return () => h("div", "child");
  },
});

function renderProvider(opts?: { publicApiKey?: string }) {
  const Host = defineComponent({
    components: { CopilotKitProvider, Child },
    template: `
      <CopilotKitProvider runtime-url="/api" :public-api-key="publicApiKey">
        <Child />
      </CopilotKitProvider>
    `,
    setup() {
      return { publicApiKey: opts?.publicApiKey };
    },
  });

  return render(Host);
}

describe("CopilotKitProvider license (server-driven)", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows no_license banner when server reports 'none'", async () => {
    vi.stubGlobal("fetch", mockFetchWithLicenseStatus("none"));

    const view = renderProvider();
    await waitFor(() => {
      expect(view.queryByText(/Powered by CopilotKit/)).not.toBeNull();
    });
  });

  it("shows expired banner when server reports 'expired'", async () => {
    vi.stubGlobal("fetch", mockFetchWithLicenseStatus("expired"));

    const view = renderProvider();
    await waitFor(() => {
      expect(view.queryByText(/expired/i)).not.toBeNull();
    });
  });

  it("shows invalid banner when server reports 'invalid'", async () => {
    vi.stubGlobal("fetch", mockFetchWithLicenseStatus("invalid"));

    const view = renderProvider();
    await waitFor(() => {
      expect(
        view.queryByText(/Invalid CopilotKit license token/i),
      ).not.toBeNull();
    });
  });

  it("shows no banner when server reports 'valid'", async () => {
    vi.stubGlobal("fetch", mockFetchWithLicenseStatus("valid"));

    const view = renderProvider();
    await waitFor(() => {
      expect(view.queryByText(/Powered by CopilotKit/)).toBeNull();
      expect(view.queryByText(/expired/i)).toBeNull();
      expect(view.queryByText(/Invalid/i)).toBeNull();
    });
  });

  it("shows no banner when licenseStatus is absent (non-intelligence mode)", async () => {
    vi.stubGlobal("fetch", mockFetchWithLicenseStatus(undefined));

    const view = renderProvider();
    await waitFor(() => {
      expect(view.queryByText(/Powered by CopilotKit/)).toBeNull();
      expect(view.queryByText(/expired/i)).toBeNull();
    });
  });
});
