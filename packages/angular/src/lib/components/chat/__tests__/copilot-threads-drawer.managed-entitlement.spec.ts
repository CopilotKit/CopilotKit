import {
  Component,
  type Signal,
  signal,
  type WritableSignal,
} from "@angular/core";
import { type ComponentFixture, TestBed } from "@angular/core/testing";
import type {
  RuntimeEntitlementResponse,
  RuntimeLicenseStatus,
} from "@copilotkit/shared";
import { expect, test, vi } from "vitest";
import { CopilotKit } from "../../../copilotkit";
import type { InjectThreadsInput, InjectThreadsResult } from "../../../threads";
import { CopilotThreadsDrawer } from "../copilot-threads-drawer";

const threadsHarness = vi.hoisted(() => ({
  input: undefined as InjectThreadsInput | undefined,
}));

vi.mock("../../../threads", async () => {
  const { signal: createSignal } =
    await vi.importActual<typeof import("@angular/core")>("@angular/core");

  return {
    injectThreads(input: InjectThreadsInput): InjectThreadsResult {
      threadsHarness.input = input;
      return {
        threads: createSignal([]),
        isLoading: createSignal(false),
        error: createSignal(null),
        listError: createSignal(null),
        fetchMoreError: createSignal(null),
        hasMoreThreads: createSignal(false),
        isFetchingMoreThreads: createSignal(false),
        isMutating: createSignal(false),
        fetchMoreThreads(): void {},
        refetchThreads(): void {},
        startNewThread(): void {},
        renameThread(): Promise<void> {
          return Promise.resolve();
        },
        archiveThread(): Promise<void> {
          return Promise.resolve();
        },
        unarchiveThread(): Promise<void> {
          return Promise.resolve();
        },
        deleteThread(): Promise<void> {
          return Promise.resolve();
        },
      };
    },
  };
});

@Component({
  standalone: true,
  imports: [CopilotThreadsDrawer],
  template: "<copilot-threads-drawer />",
})
class ManagedEntitlementHost {
  readonly rendered = true;
}

type LicensedDrawerElement = HTMLElement & {
  licensed: boolean;
  loading: boolean;
};

interface ManagedEntitlementSetup {
  authority: {
    licenseStatus: WritableSignal<RuntimeLicenseStatus | undefined>;
    retryPending: WritableSignal<boolean>;
    runtimeEntitlements: WritableSignal<RuntimeEntitlementResponse | undefined>;
  };
  dispose: () => void;
  drawer: LicensedDrawerElement;
  fixture: ComponentFixture<ManagedEntitlementHost>;
  threadsEnabled: () => boolean;
}

function readBoolean(
  value: boolean | Signal<boolean | undefined> | undefined,
): boolean {
  return typeof value === "function" ? value() !== false : value !== false;
}

/**
 * Mount the drawer with reactive Runtime license authority.
 */
function setupManagedEntitlement(
  licenseStatus: RuntimeLicenseStatus | undefined,
  runtimeEntitlements: RuntimeEntitlementResponse | undefined,
  runtimeEntitlementRetryPending = false,
): ManagedEntitlementSetup {
  const licenseStatusSignal = signal(licenseStatus);
  const runtimeEntitlementsSignal = signal(runtimeEntitlements);
  const retryPendingSignal = signal(runtimeEntitlementRetryPending);
  const fakeCopilotKit = {
    licenseStatus: licenseStatusSignal.asReadonly(),
    runtimeEntitlements: runtimeEntitlementsSignal.asReadonly(),
    runtimeEntitlementRetryPending: retryPendingSignal.asReadonly(),
  };

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [ManagedEntitlementHost],
    providers: [{ provide: CopilotKit, useValue: fakeCopilotKit }],
  });

  const fixture = TestBed.createComponent(ManagedEntitlementHost);
  fixture.detectChanges();
  const drawer = (
    fixture.nativeElement as HTMLElement
  ).querySelector<LicensedDrawerElement>("copilotkit-threads-drawer");
  if (!drawer) {
    throw new Error("Managed entitlement test did not render the drawer");
  }
  const input = threadsHarness.input;
  if (!input) {
    throw new Error("Managed entitlement test did not initialize threads");
  }

  return {
    authority: {
      licenseStatus: licenseStatusSignal,
      retryPending: retryPendingSignal,
      runtimeEntitlements: runtimeEntitlementsSignal,
    },
    dispose() {
      fixture.destroy();
      TestBed.resetTestingModule();
      threadsHarness.input = undefined;
    },
    drawer,
    fixture,
    threadsEnabled: () => readBoolean(input.enabled),
  };
}

const RETRYABLE_MANAGED_ENTITLEMENT: RuntimeEntitlementResponse = {
  status: "unavailable",
  error: {
    code: "runtime_entitlements_unavailable",
    message: "Runtime entitlement lookup failed",
    retryable: true,
  },
};

/** Mirror the active/inactive managed shapes emitted by Intelligence. */
function readyManagedEntitlement(active: boolean): RuntimeEntitlementResponse {
  return {
    status: "ready",
    entitlement: {
      active,
      source: "managedOrgSubscription",
      ...(active
        ? {
            planCode: "free",
            entitlementSource: "clerk_free_default",
            features: {
              "sdk.angular": false,
              deployment_via_helm_chart: false,
              analytics: true,
              self_learning: true,
              msteams: false,
              memory: false,
              managed_channels: true,
              "managed_channels.slack": true,
              "managed_channels.teams": true,
            },
            limits: {
              "threads.retention_hours": 72,
              "threads.max_count": 200,
            },
          }
        : { features: {}, limits: {} }),
    },
  };
}

/** Mirror the active self-hosted shape emitted by Intelligence. */
const READY_SELF_HOSTED_ENTITLEMENT = {
  status: "ready",
  entitlement: {
    active: true,
    source: "selfHostedDeploymentLicense",
    features: { deployment_via_helm_chart: true, msteams: true },
    limits: {
      "threads.retention_hours": 336,
      "threads.max_count": 25_000,
    },
    planCode: "team_self_hosted",
    entitlementSource: "enterprise_override",
  },
} as const satisfies RuntimeEntitlementResponse;

test.each([
  {
    expectedLicensed: true,
    label: "grant",
    legacyStatus: "none" as const,
    active: true,
  },
  {
    expectedLicensed: false,
    label: "denial",
    legacyStatus: "none" as const,
    active: false,
  },
])(
  "a retry-pending Angular drawer reacts after mount to a managed $label",
  async ({ active, expectedLicensed, legacyStatus }) => {
    const { authority, dispose, drawer, fixture, threadsEnabled } =
      setupManagedEntitlement("unknown", RETRYABLE_MANAGED_ENTITLEMENT, true);

    try {
      await fixture.whenStable();

      expect(threadsEnabled()).toBe(false);
      expect(drawer.licensed).toBe(true);
      expect(drawer.loading).toBe(true);

      authority.licenseStatus.set(legacyStatus);
      authority.runtimeEntitlements.set(readyManagedEntitlement(active));
      authority.retryPending.set(false);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(threadsEnabled()).toBe(active);
      expect(drawer.licensed).toBe(expectedLicensed);
      expect(drawer.loading).toBe(false);
    } finally {
      dispose();
    }
  },
);

test("an active self-hosted producer entitlement grants Angular threads", async () => {
  const { dispose, drawer, fixture, threadsEnabled } = setupManagedEntitlement(
    "invalid",
    READY_SELF_HOSTED_ENTITLEMENT,
  );

  try {
    await fixture.whenStable();

    expect(threadsEnabled()).toBe(true);
    expect(drawer.licensed).toBe(true);
  } finally {
    dispose();
  }
});

test("a settled non-ready entitlement denies Angular threads without a legacy fallback", async () => {
  const { dispose, drawer, fixture, threadsEnabled } = setupManagedEntitlement(
    "unknown",
    RETRYABLE_MANAGED_ENTITLEMENT,
  );

  try {
    await fixture.whenStable();

    expect(threadsEnabled()).toBe(false);
    expect(drawer.licensed).toBe(false);
    expect(drawer.loading).toBe(false);
  } finally {
    dispose();
  }
});

test("an inactive self-hosted entitlement keeps Angular's valid legacy fallback", async () => {
  const { dispose, drawer, fixture, threadsEnabled } = setupManagedEntitlement(
    "valid",
    {
      status: "ready",
      entitlement: {
        active: false,
        source: "selfHostedDeploymentLicense",
        features: {},
        limits: {},
      },
    },
  );

  try {
    await fixture.whenStable();

    expect(threadsEnabled()).toBe(true);
    expect(drawer.licensed).toBe(true);
  } finally {
    dispose();
  }
});
