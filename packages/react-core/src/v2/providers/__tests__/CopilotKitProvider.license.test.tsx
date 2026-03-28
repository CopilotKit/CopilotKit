import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import React from "react";
import { CopilotKitProvider } from "../CopilotKitProvider";

/**
 * These tests verify that the license banner is driven by the server-reported
 * licenseStatus field in the /info response — not by client-side token verification.
 */

function mockFetchWithLicenseStatus(licenseStatus?: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      version: "1.0.0",
      agents: {},
      audioFileTranscriptionEnabled: false,
      mode: "intelligence",
      licenseStatus,
    }),
  });
}

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("CopilotKitProvider license (server-driven)", () => {
  it("shows no_license banner when server reports 'none'", async () => {
    globalThis.fetch = mockFetchWithLicenseStatus("none") as any;
    render(
      <CopilotKitProvider runtimeUrl="/api">
        <div>child</div>
      </CopilotKitProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText(/Powered by CopilotKit/)).toBeTruthy();
    });
  });

  it("shows expired banner when server reports 'expired'", async () => {
    globalThis.fetch = mockFetchWithLicenseStatus("expired") as any;
    render(
      <CopilotKitProvider runtimeUrl="/api">
        <div>child</div>
      </CopilotKitProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText(/expired/i)).toBeTruthy();
    });
  });

  it("shows invalid banner when server reports 'invalid'", async () => {
    globalThis.fetch = mockFetchWithLicenseStatus("invalid") as any;
    render(
      <CopilotKitProvider runtimeUrl="/api">
        <div>child</div>
      </CopilotKitProvider>,
    );
    await waitFor(() => {
      expect(
        screen.getByText(/Invalid CopilotKit license token/i),
      ).toBeTruthy();
    });
  });

  it("shows no banner when server reports 'valid'", async () => {
    globalThis.fetch = mockFetchWithLicenseStatus("valid") as any;
    render(
      <CopilotKitProvider runtimeUrl="/api">
        <div>child</div>
      </CopilotKitProvider>,
    );
    // Wait for runtime connection to complete
    await waitFor(() => {
      expect(screen.queryByText(/Powered by CopilotKit/)).toBeNull();
      expect(screen.queryByText(/expired/i)).toBeNull();
      expect(screen.queryByText(/Invalid/i)).toBeNull();
    });
  });

  it("shows no banner when licenseStatus is absent (non-intelligence mode)", async () => {
    globalThis.fetch = mockFetchWithLicenseStatus(undefined) as any;
    render(
      <CopilotKitProvider runtimeUrl="/api">
        <div>child</div>
      </CopilotKitProvider>,
    );
    await waitFor(() => {
      expect(screen.queryByText(/Powered by CopilotKit/)).toBeNull();
      expect(screen.queryByText(/expired/i)).toBeNull();
    });
  });
});
