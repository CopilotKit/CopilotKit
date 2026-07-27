import { cleanup, render, waitFor } from "@testing-library/vue";
import type {
  RuntimeEntitlementResponse,
  RuntimeInfo,
} from "@copilotkit/shared";
import { defineComponent, h, nextTick } from "vue";
import { expect, test, vi } from "vitest";
import CopilotKitProvider from "../CopilotKitProvider.vue";
import { useLicenseContext } from "../useLicenseContext";

const AuthorityProbe = defineComponent({
  setup() {
    const license = useLicenseContext();
    return () =>
      h(
        "output",
        { "data-testid": "runtime-license-authority" },
        [
          `status:${license.value.status ?? "null"}`,
          `chat:${license.value.checkFeature("chat")}`,
          `sidebar:${license.value.checkFeature("sidebar")}`,
          `popup:${license.value.checkFeature("popup")}`,
          `threads:${license.value.checkFeature("threads")}`,
        ].join(" "),
      );
  },
});

function managedRuntimeInfo(
  enabled: boolean,
  licenseStatus: RuntimeInfo["licenseStatus"],
): RuntimeInfo {
  return {
    version: "1.0.0",
    agents: {},
    audioFileTranscriptionEnabled: false,
    mode: "intelligence",
    licenseStatus,
    runtimeEntitlements: {
      status: "ready",
      entitlement: {
        active: true,
        source: "managedOrgSubscription",
        planCode: "pro",
        features: {
          chat: enabled,
          sidebar: enabled,
          popup: enabled,
          threads: enabled,
        },
        limits: {},
      },
    },
  };
}

function retryableRuntimeInfo(
  licenseStatus: RuntimeInfo["licenseStatus"] = "unknown",
): RuntimeInfo {
  const runtimeEntitlements: RuntimeEntitlementResponse = {
    status: "unavailable",
    error: {
      code: "runtime_entitlements_unavailable",
      message: "Runtime entitlement lookup failed",
      retryable: true,
    },
  };
  return {
    ...managedRuntimeInfo(true, licenseStatus),
    runtimeEntitlements,
  };
}

interface RuntimeAuthoritySetup {
  dispose: () => void;
  fetchMock: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;
  readAuthority: () => string;
  view: ReturnType<typeof render>;
}

/**
 * Render the provider against ordered `/info` responses.
 */
function setupRuntimeAuthority(
  ...runtimeInfoResponses: [RuntimeInfo, ...RuntimeInfo[]]
): RuntimeAuthoritySetup {
  const fetchMock = vi.fn<typeof globalThis.fetch>();
  for (const runtimeInfo of runtimeInfoResponses) {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(runtimeInfo), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }
  vi.stubGlobal("fetch", fetchMock);

  const view = render(CopilotKitProvider, {
    props: { runtimeUrl: "/api" },
    slots: { default: () => h(AuthorityProbe) },
  });

  return {
    dispose() {
      view.unmount();
      cleanup();
      vi.unstubAllGlobals();
    },
    fetchMock,
    readAuthority: () =>
      view.getByTestId("runtime-license-authority").textContent ?? "",
    view,
  };
}

async function flushPromiseUpdates(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  await nextTick();
}

test("a ready managed grant drives every Vue feature gate and overrides a stale invalid token", async () => {
  const { dispose, readAuthority, view } = setupRuntimeAuthority(
    managedRuntimeInfo(true, "invalid"),
  );

  try {
    await waitFor(() => {
      expect(readAuthority()).toBe(
        "status:valid chat:true sidebar:true popup:true threads:true",
      );
    });
    expect(view.queryByText(/Invalid CopilotKit license token/i)).toBeNull();
  } finally {
    dispose();
  }
});

test("a ready managed denial drives every Vue feature gate despite a valid legacy status", async () => {
  const { dispose, readAuthority } = setupRuntimeAuthority(
    managedRuntimeInfo(false, "valid"),
  );

  try {
    await waitFor(() => {
      expect(readAuthority()).toBe(
        "status:valid chat:false sidebar:false popup:false threads:false",
      );
    });
  } finally {
    dispose();
  }
});

test("a retryable managed lookup keeps every Vue gate pending and hides stale warnings until recovery", async () => {
  vi.useFakeTimers();
  const { dispose, fetchMock, readAuthority, view } = setupRuntimeAuthority(
    retryableRuntimeInfo("invalid"),
    managedRuntimeInfo(true, "invalid"),
  );

  try {
    await flushPromiseUpdates();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(readAuthority()).toBe(
      "status:null chat:true sidebar:true popup:true threads:true",
    );
    expect(view.queryByText(/Invalid CopilotKit license token/i)).toBeNull();

    await vi.advanceTimersByTimeAsync(5_000);
    await nextTick();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readAuthority()).toBe(
      "status:valid chat:true sidebar:true popup:true threads:true",
    );
  } finally {
    dispose();
    vi.useRealTimers();
  }
});

test("a persistent retryable lookup denies every Vue gate after Core's bounded retry settles", async () => {
  vi.useFakeTimers();
  const { dispose, fetchMock, readAuthority } = setupRuntimeAuthority(
    retryableRuntimeInfo(),
    retryableRuntimeInfo(),
  );

  try {
    await flushPromiseUpdates();

    expect(readAuthority()).toBe(
      "status:null chat:true sidebar:true popup:true threads:true",
    );

    await vi.advanceTimersByTimeAsync(5_000);
    await nextTick();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readAuthority()).toBe(
      "status:unknown chat:false sidebar:false popup:false threads:false",
    );

    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally {
    dispose();
    vi.useRealTimers();
  }
});

test("an inactive self-hosted entitlement keeps Vue's valid legacy fallback", async () => {
  const runtimeInfo: RuntimeInfo = {
    ...managedRuntimeInfo(false, "valid"),
    runtimeEntitlements: {
      status: "ready",
      entitlement: {
        active: false,
        source: "selfHostedDeploymentLicense",
        features: {
          chat: false,
          sidebar: false,
          popup: false,
          threads: false,
        },
        limits: {},
      },
    },
  };
  const { dispose, readAuthority } = setupRuntimeAuthority(runtimeInfo);

  try {
    await waitFor(() => {
      expect(readAuthority()).toBe(
        "status:valid chat:true sidebar:true popup:true threads:true",
      );
    });
  } finally {
    dispose();
  }
});
