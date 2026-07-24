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

function readyManagedEntitlement(threads: boolean): RuntimeEntitlementResponse {
  return {
    status: "ready",
    entitlement: {
      active: true,
      source: "managedOrgSubscription",
      planCode: "pro",
      features: { threads },
      limits: {},
    },
  };
}

test.each([
  {
    expectedLicensed: true,
    label: "grant",
    legacyStatus: "none" as const,
    threads: true,
  },
  {
    expectedLicensed: false,
    label: "denial",
    legacyStatus: "valid" as const,
    threads: false,
  },
])(
  "a retry-pending Angular drawer reacts after mount to a managed $label",
  async ({ expectedLicensed, legacyStatus, threads }) => {
    const { authority, dispose, drawer, fixture, threadsEnabled } =
      setupManagedEntitlement("unknown", RETRYABLE_MANAGED_ENTITLEMENT, true);

    try {
      await fixture.whenStable();

      expect(threadsEnabled()).toBe(false);
      expect(drawer.licensed).toBe(true);
      expect(drawer.loading).toBe(true);

      authority.licenseStatus.set(legacyStatus);
      authority.runtimeEntitlements.set(readyManagedEntitlement(threads));
      authority.retryPending.set(false);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(threadsEnabled()).toBe(threads);
      expect(drawer.licensed).toBe(expectedLicensed);
      expect(drawer.loading).toBe(false);
    } finally {
      dispose();
    }
  },
);

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
        features: { threads: false },
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
