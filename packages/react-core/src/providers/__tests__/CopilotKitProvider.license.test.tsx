import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import React from "react";
import { CopilotKitProvider } from "../CopilotKitProvider";
import { useLicenseContext } from "../../context";

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

describe("CopilotKitProvider license context (server-driven)", () => {
  function LicenseProbe() {
    const { status, checkFeature } = useLicenseContext();
    return (
      <div data-testid="license-probe">
        {`status:${status ?? "null"} chat:${checkFeature("chat")}`}
      </div>
    );
  }

  async function probeWithStatus(licenseStatus?: string) {
    globalThis.fetch = mockFetchWithLicenseStatus(licenseStatus) as any;
    render(
      <CopilotKitProvider runtimeUrl="/api">
        <LicenseProbe />
      </CopilotKitProvider>,
    );
    return screen.getByTestId("license-probe");
  }

  it("enables features when server reports 'valid'", async () => {
    const probe = await probeWithStatus("valid");
    await waitFor(() => {
      expect(probe.textContent).toBe("status:valid chat:true");
    });
  });

  it("enables features when server reports 'none'", async () => {
    const probe = await probeWithStatus("none");
    await waitFor(() => {
      expect(probe.textContent).toBe("status:none chat:true");
    });
  });

  it("disables features when server reports 'expired'", async () => {
    const probe = await probeWithStatus("expired");
    await waitFor(() => {
      expect(probe.textContent).toBe("status:expired chat:false");
    });
  });

  it("disables features when server reports 'invalid'", async () => {
    const probe = await probeWithStatus("invalid");
    await waitFor(() => {
      expect(probe.textContent).toBe("status:invalid chat:false");
    });
  });

  it("fails open while status is not yet known", async () => {
    const probe = await probeWithStatus(undefined);
    await waitFor(() => {
      expect(probe.textContent).toBe("status:null chat:true");
    });
  });
});
