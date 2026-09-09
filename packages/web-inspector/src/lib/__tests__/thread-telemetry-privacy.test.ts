import { expect, test, vi } from "vitest";
import type { MockInstance } from "vitest";

import {
  ensureTelemetryDistinctId,
  getTelemetryDistinctIdForUrl,
  maybeShowDisclosure,
  trackMetadataActionClicked,
  trackMetadataModuleViewed,
  trackTalkToEngineerClicked,
  trackThreadsEmptyEnabledViewed,
  trackThreadsEnabledViewed,
  trackThreadsExampleSelected,
  trackThreadsExampleTourCompleted,
  trackThreadsExampleTourDismissed,
  trackThreadsExampleTourReopened,
  trackThreadsExampleTourStarted,
  trackThreadsExampleTourStepViewed,
  trackThreadsExampleViewed,
  trackThreadsIntelligenceSignupClicked,
  trackThreadsLockedViewed,
  trackThreadsTabClicked,
  trackThreadsTalkToEngineerClicked,
  trackThreadsTryFromHereClicked,
} from "../telemetry.js";
import type {
  InspectorMetadataActionClickedTelemetryProps,
  InspectorMetadataModuleViewedTelemetryProps,
  InspectorThreadTelemetryProps,
  TelemetryEvent,
} from "../telemetry.js";
import {
  _resetTelemetryPersistenceForTesting,
  setTelemetryOptOut,
} from "../persistence.js";

const TEST_UUID = "00000000-0000-4000-8000-000000000001";
const PACKAGE_PROPERTY_KEYS = Object.freeze([
  "distinct_id",
  "inspector_distinct_id",
  "package_name",
  "package_version",
]);

type ThreadCommonKey =
  | "intelligence_status"
  | "thread_service_status"
  | "license_status"
  | "runtime_mode"
  | "runtime_url_type"
  | "telemetry_disabled"
  | "has_threads"
  | "usage_bucket"
  | "expiry_bucket"
  | "group_key"
  | "leaf_key";

type ThreadEventKey =
  | "cta"
  | "cta_surface"
  | "posthog_distinct_id"
  | "example_kind"
  | "tour_step"
  | "tour_tab"
  | "dismiss_method"
  | "outcome";

type ThreadEventFields = Required<
  Pick<InspectorThreadTelemetryProps, ThreadEventKey>
>;

type ForbiddenTelemetryFields = Readonly<{
  organization_name: string;
  organization_code: string;
  project_name: string;
  project_code: string;
  plan_name: string;
  plan_code: string;
  action_url: string;
  runtime_url: string;
  used: number;
  limit: number;
  expiry_count: number;
  row_count: number;
  thread_id: string;
  agent_id: string;
  message_id: string;
  content_id: string;
  name: string;
  message: string;
  events: string;
  state: string;
  prompt: string;
  completion: string;
}>;

type ThreadPrivacyProbe = InspectorThreadTelemetryProps &
  Required<Pick<InspectorThreadTelemetryProps, ThreadCommonKey>> &
  ThreadEventFields &
  ForbiddenTelemetryFields;

type MetadataPrivacyProbe = InspectorMetadataModuleViewedTelemetryProps &
  InspectorMetadataActionClickedTelemetryProps &
  ForbiddenTelemetryFields;

type TelemetryBody = Readonly<{
  event: string;
  properties: object;
}>;

type FetchMock = ReturnType<
  typeof vi.fn<
    (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  >
>;

type TestContext = Readonly<{
  fetchMock: FetchMock;
  requests: readonly RequestInit[];
  randomUuidSpy: MockInstance<Crypto["randomUUID"]>;
  storageSetSpy: MockInstance<Storage["setItem"]>;
  consoleInfoSpy: MockInstance<typeof console.info>;
  teardown: () => void;
}>;

type ThreadHelperCase = Readonly<{
  name: string;
  invoke: (input: ThreadPrivacyProbe) => void;
  expectedEvent: TelemetryEvent;
  eventOverrides?: Partial<ThreadEventFields>;
  expectedProperties: Readonly<object>;
}>;

type MetadataHelperCase = Readonly<{
  name: string;
  invoke: (input: MetadataPrivacyProbe) => void;
  expectedEvent: TelemetryEvent;
  expectedModule: "plan" | "action";
}>;

function setup(): TestContext {
  window.localStorage.clear();
  _resetTelemetryPersistenceForTesting();
  const requests: RequestInit[] = [];
  const fetchMock = vi.fn<
    (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  >((_input, init) => {
    if (init !== undefined) requests.push(init);
    return Promise.resolve(new Response(null, { status: 204 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  const randomUuidSpy = vi
    .spyOn(globalThis.crypto, "randomUUID")
    .mockReturnValue(TEST_UUID);
  const storageSetSpy = vi.spyOn(window.localStorage, "setItem");
  const consoleInfoSpy = vi
    .spyOn(console, "info")
    .mockImplementation(() => undefined);

  return {
    fetchMock,
    requests,
    randomUuidSpy,
    storageSetSpy,
    consoleInfoSpy,
    teardown: () => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      window.localStorage.clear();
      _resetTelemetryPersistenceForTesting();
    },
  };
}

function createForbiddenFields(prefix: string): ForbiddenTelemetryFields {
  return {
    organization_name: `${prefix}-organization-name-sentinel`,
    organization_code: `${prefix}-organization-code-sentinel`,
    project_name: `${prefix}-project-name-sentinel`,
    project_code: `${prefix}-project-code-sentinel`,
    plan_name: `${prefix}-plan-name-sentinel`,
    plan_code: `${prefix}-plan-code-sentinel`,
    action_url: `https://action.invalid/${prefix}-action-url-sentinel`,
    runtime_url: `https://runtime.invalid/${prefix}-runtime-url-sentinel`,
    used: 910_001,
    limit: 920_002,
    expiry_count: 930_003,
    row_count: 940_004,
    thread_id: `${prefix}-thread-id-sentinel`,
    agent_id: `${prefix}-agent-id-sentinel`,
    message_id: `${prefix}-message-id-sentinel`,
    content_id: `${prefix}-content-id-sentinel`,
    name: `${prefix}-name-sentinel`,
    message: `${prefix}-message-sentinel`,
    events: `${prefix}-events-sentinel`,
    state: `${prefix}-state-sentinel`,
    prompt: `${prefix}-prompt-sentinel`,
    completion: `${prefix}-completion-sentinel`,
  };
}

function expectedThreadCommonProperties(): Readonly<
  Pick<ThreadPrivacyProbe, ThreadCommonKey>
> {
  return {
    intelligence_status: "intelligence_enabled",
    thread_service_status: "available",
    license_status: "valid",
    runtime_mode: "intelligence",
    runtime_url_type: "remote",
    telemetry_disabled: false,
    has_threads: true,
    usage_bucket: "within_limit",
    expiry_bucket: "positive",
    group_key: "workbench",
    leaf_key: "threads",
  };
}

function createThreadFixture(
  prefix: string,
  overrides: Partial<ThreadEventFields> = {},
): Readonly<{
  input: ThreadPrivacyProbe;
  forbidden: ForbiddenTelemetryFields;
}> {
  const forbidden = createForbiddenFields(prefix);
  const input: ThreadPrivacyProbe = {
    ...expectedThreadCommonProperties(),
    cta: overrides.cta ?? "talk_to_engineer",
    cta_surface: overrides.cta_surface ?? "threads_header",
    posthog_distinct_id:
      overrides.posthog_distinct_id ?? "posthog-anonymous-sentinel",
    example_kind: overrides.example_kind ?? "realtime_sync",
    tour_step: overrides.tour_step ?? 1,
    tour_tab: overrides.tour_tab ?? "timeline",
    dismiss_method: overrides.dismiss_method ?? "skip",
    outcome: overrides.outcome ?? "success",
    ...forbidden,
  };

  return { input, forbidden };
}

function createMetadataFixture(prefix: string): Readonly<{
  input: MetadataPrivacyProbe;
  forbidden: ForbiddenTelemetryFields;
}> {
  const forbidden = createForbiddenFields(prefix);
  const input: MetadataPrivacyProbe = {
    module: "plan",
    action_kind: "renew",
    license_bucket: "expired",
    usage_bucket: "at_or_over_limit",
    expiry_bucket: "zero",
    group_key: "workbench",
    leaf_key: "threads",
    action_placement: "threads_footer",
    ...forbidden,
  };

  return { input, forbidden };
}

function parseBody(init: RequestInit | undefined): TelemetryBody {
  expect(init).toBeDefined();
  expect(typeof init?.body).toBe("string");
  return JSON.parse(String(init?.body));
}

function expectExactPropertyKeys(
  properties: object,
  featureKeys: readonly string[],
): void {
  expect(Object.keys(properties).sort()).toEqual(
    [...featureKeys, ...PACKAGE_PROPERTY_KEYS].sort(),
  );
}

function expectNoForbiddenProperties(
  properties: object,
  forbidden: ForbiddenTelemetryFields,
): void {
  for (const key of Object.keys(forbidden)) {
    expect(properties).not.toHaveProperty(key);
  }
  const serializedProperties = JSON.stringify(properties);
  for (const value of Object.values(forbidden)) {
    expect(serializedProperties).not.toContain(String(value));
  }
}

test.each<ThreadHelperCase>([
  {
    name: "threads tab clicked",
    invoke: trackThreadsTabClicked,
    expectedEvent: "oss.inspector.threads_tab_clicked",
    expectedProperties: {},
  },
  {
    name: "threads try from here clicked",
    invoke: trackThreadsTryFromHereClicked,
    expectedEvent: "oss.inspector.threads_try_from_here_clicked",
    eventOverrides: { outcome: "success" },
    expectedProperties: { outcome: "success" },
  },
  {
    name: "threads locked viewed",
    invoke: trackThreadsLockedViewed,
    expectedEvent: "oss.inspector.threads_locked_viewed",
    expectedProperties: {},
  },
  {
    name: "Intelligence signup clicked",
    invoke: trackThreadsIntelligenceSignupClicked,
    expectedEvent: "oss.inspector.threads_intelligence_signup_clicked",
    eventOverrides: {
      cta: "signup",
      cta_surface: "threads_locked",
    },
    expectedProperties: {
      cta: "signup",
      cta_surface: "threads_locked",
      posthog_distinct_id: "posthog-anonymous-sentinel",
    },
  },
  {
    name: "Threads talk-to-engineer clicked",
    invoke: trackThreadsTalkToEngineerClicked,
    expectedEvent: "oss.inspector.threads_talk_to_engineer_clicked",
    eventOverrides: { cta_surface: "threads_locked" },
    expectedProperties: {
      cta: "talk_to_engineer",
      cta_surface: "threads_locked",
      posthog_distinct_id: "posthog-anonymous-sentinel",
    },
  },
  {
    name: "separate talk-to-engineer clicked",
    invoke: trackTalkToEngineerClicked,
    expectedEvent: "oss.inspector.talk_to_engineer_clicked",
    expectedProperties: {
      cta: "talk_to_engineer",
      cta_surface: "threads_header",
      posthog_distinct_id: "posthog-anonymous-sentinel",
    },
  },
  {
    name: "threads empty enabled viewed",
    invoke: trackThreadsEmptyEnabledViewed,
    expectedEvent: "oss.inspector.threads_empty_enabled_viewed",
    expectedProperties: {},
  },
  {
    name: "threads enabled viewed",
    invoke: trackThreadsEnabledViewed,
    expectedEvent: "oss.inspector.threads_enabled_viewed",
    expectedProperties: {},
  },
  {
    name: "realtime sync example viewed",
    invoke: trackThreadsExampleViewed,
    expectedEvent: "oss.inspector.threads_example_viewed",
    eventOverrides: { example_kind: "realtime_sync" },
    expectedProperties: { example_kind: "realtime_sync" },
  },
  {
    name: "manage history example selected",
    invoke: trackThreadsExampleSelected,
    expectedEvent: "oss.inspector.threads_example_selected",
    eventOverrides: { example_kind: "manage_history" },
    expectedProperties: { example_kind: "manage_history" },
  },
  {
    name: "inspect runs tour started at timeline",
    invoke: trackThreadsExampleTourStarted,
    expectedEvent: "oss.inspector.threads_example_tour_started",
    eventOverrides: {
      example_kind: "inspect_runs",
      tour_step: 1,
      tour_tab: "timeline",
    },
    expectedProperties: {
      example_kind: "inspect_runs",
      tour_step: 1,
      tour_tab: "timeline",
    },
  },
  {
    name: "realtime sync tour viewed at raw events",
    invoke: trackThreadsExampleTourStepViewed,
    expectedEvent: "oss.inspector.threads_example_tour_step_viewed",
    eventOverrides: {
      example_kind: "realtime_sync",
      tour_step: 2,
      tour_tab: "raw-events",
    },
    expectedProperties: {
      example_kind: "realtime_sync",
      tour_step: 2,
      tour_tab: "raw-events",
    },
  },
  {
    name: "manage history tour dismissed at state",
    invoke: trackThreadsExampleTourDismissed,
    expectedEvent: "oss.inspector.threads_example_tour_dismissed",
    eventOverrides: {
      example_kind: "manage_history",
      tour_step: 3,
      tour_tab: "state",
      dismiss_method: "skip",
    },
    expectedProperties: {
      example_kind: "manage_history",
      tour_step: 3,
      tour_tab: "state",
      dismiss_method: "skip",
    },
  },
  {
    name: "inspect runs tour completed at state",
    invoke: trackThreadsExampleTourCompleted,
    expectedEvent: "oss.inspector.threads_example_tour_completed",
    eventOverrides: {
      example_kind: "inspect_runs",
      tour_step: 3,
      tour_tab: "state",
      dismiss_method: "done",
    },
    expectedProperties: {
      example_kind: "inspect_runs",
      tour_step: 3,
      tour_tab: "state",
      dismiss_method: "done",
    },
  },
  {
    name: "realtime sync tour reopened at timeline",
    invoke: trackThreadsExampleTourReopened,
    expectedEvent: "oss.inspector.threads_example_tour_reopened",
    eventOverrides: {
      example_kind: "realtime_sync",
      tour_step: 1,
      tour_tab: "timeline",
    },
    expectedProperties: {
      example_kind: "realtime_sync",
      tour_step: 1,
      tour_tab: "timeline",
    },
  },
])("$name sends one exact coarse request", async (testCase) => {
  const context = setup();
  try {
    const fixture = createThreadFixture(testCase.name, testCase.eventOverrides);

    testCase.invoke(fixture.input);
    await Promise.resolve();

    expect(context.fetchMock).toHaveBeenCalledTimes(1);
    expect(context.requests).toHaveLength(1);
    const body = parseBody(context.requests[0]);
    const commonProperties = expectedThreadCommonProperties();
    expect(body.event).toBe(testCase.expectedEvent);
    expect(body.properties).toMatchObject({
      ...commonProperties,
      ...testCase.expectedProperties,
      distinct_id: TEST_UUID,
      inspector_distinct_id: TEST_UUID,
      package_name: "@copilotkit/web-inspector",
    });
    expectExactPropertyKeys(body.properties, [
      ...Object.keys(commonProperties),
      ...Object.keys(testCase.expectedProperties),
    ]);
    expectNoForbiddenProperties(body.properties, fixture.forbidden);
  } finally {
    context.teardown();
  }
});

test.each<MetadataHelperCase>([
  {
    name: "metadata module viewed",
    invoke: trackMetadataModuleViewed,
    expectedEvent: "oss.inspector.metadata_module_viewed",
    expectedModule: "plan",
  },
  {
    name: "metadata action clicked",
    invoke: trackMetadataActionClicked,
    expectedEvent: "oss.inspector.metadata_action_clicked",
    expectedModule: "action",
  },
])("$name rebuilds its serialized allowlist", async (testCase) => {
  const context = setup();
  try {
    const fixture = createMetadataFixture(testCase.name);

    testCase.invoke(fixture.input);
    await Promise.resolve();

    expect(context.fetchMock).toHaveBeenCalledTimes(1);
    expect(context.requests).toHaveLength(1);
    const body = parseBody(context.requests[0]);
    const expectedProperties = {
      module: testCase.expectedModule,
      action_kind: "renew",
      license_bucket: "expired",
      usage_bucket: "at_or_over_limit",
      expiry_bucket: "zero",
      group_key: "workbench",
      leaf_key: "threads",
      action_placement: "threads_footer",
    };
    expect(body.event).toBe(testCase.expectedEvent);
    expect(body.properties).toMatchObject({
      ...expectedProperties,
      distinct_id: TEST_UUID,
      inspector_distinct_id: TEST_UUID,
      package_name: "@copilotkit/web-inspector",
    });
    expectExactPropertyKeys(body.properties, Object.keys(expectedProperties));
    expectNoForbiddenProperties(body.properties, fixture.forbidden);
  } finally {
    context.teardown();
  }
});

test("persisted opt-out returns before identity, storage, disclosure, attribution, serialization, or fetch", async () => {
  const context = setup();
  try {
    setTelemetryOptOut(true);
    context.storageSetSpy.mockClear();
    const stringifySpy = vi.spyOn(JSON, "stringify");
    const fixture = createThreadFixture("persisted-opt-out");

    const attributionId = getTelemetryDistinctIdForUrl();
    ensureTelemetryDistinctId();
    maybeShowDisclosure();
    trackThreadsEnabledViewed(fixture.input);
    await Promise.resolve();

    expect(attributionId).toBeNull();
    expect(context.randomUuidSpy).not.toHaveBeenCalled();
    expect(context.storageSetSpy).not.toHaveBeenCalled();
    expect(
      window.localStorage.getItem("cpk:inspector:telemetry:distinct_id"),
    ).toBeNull();
    expect(
      window.localStorage.getItem("cpk:inspector:telemetry:disclosure_shown"),
    ).toBeNull();
    expect(context.consoleInfoSpy).not.toHaveBeenCalled();
    expect(stringifySpy).not.toHaveBeenCalled();
    expect(context.fetchMock).not.toHaveBeenCalled();
    expect(context.requests).toEqual([]);
  } finally {
    context.teardown();
  }
});

test("a rejected Thread telemetry request stays best-effort", async () => {
  const context = setup();
  const unhandledRejectionSpy = vi.fn<(event: PromiseRejectionEvent) => void>();
  window.addEventListener("unhandledrejection", unhandledRejectionSpy);
  try {
    context.fetchMock.mockRejectedValueOnce(new Error("network down"));
    const fixture = createThreadFixture("rejected-request");

    expect(() => trackThreadsTabClicked(fixture.input)).not.toThrow();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

    expect(context.fetchMock).toHaveBeenCalledTimes(1);
    const body = parseBody(context.fetchMock.mock.calls[0]?.[1]);
    const commonProperties = expectedThreadCommonProperties();
    expect(body.event).toBe("oss.inspector.threads_tab_clicked");
    expectExactPropertyKeys(body.properties, Object.keys(commonProperties));
    expectNoForbiddenProperties(body.properties, fixture.forbidden);
    expect(unhandledRejectionSpy).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener("unhandledrejection", unhandledRejectionSpy);
    context.teardown();
  }
});
