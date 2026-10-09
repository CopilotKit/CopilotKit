import { expect, test, vi } from "vitest";
import type { RuntimeInfo } from "@copilotkit/shared";
import type { InspectorMetadataV1 } from "../types";
import type { CopilotKitCoreSubscriber } from "../core";
import { CopilotKitCore, CopilotKitCoreRuntimeConnectionStatus } from "../core";
import { waitForCondition as waitFor } from "./test-utils";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

type CapturedRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  credentials: RequestCredentials | undefined;
  body: unknown;
  signal: AbortSignal | undefined;
};

type RuntimeInfoOverrides = {
  inspectorMetadata?: boolean;
  version?: string;
};

type InspectorMetadataChangedEvent = Parameters<
  NonNullable<CopilotKitCoreSubscriber["onInspectorMetadataChanged"]>
>[0];

type SetupOptions = {
  runtimeUrl?: string;
  runtimeTransport?: "auto" | "rest" | "single";
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  runtimeInfo?: RuntimeInfoOverrides[];
  runtimeInfoFetchResponses?: Array<Response | Promise<Response>>;
  metadataResponses?: Array<Response | Promise<Response>>;
};

const runtimeOne = "https://runtime-one.example/api/copilotkit";
const runtimeTwo = "https://runtime-two.example/api/copilotkit";

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function metadata(label: string): InspectorMetadataV1 {
  return {
    schemaVersion: 1,
    identity: {
      organizationName: "Acme",
      projectName: `Project ${label}`,
    },
    plan: { code: label.toLowerCase(), label },
    license: { state: "valid" },
    action: {
      kind: "manage_plan",
      url: "https://cloud.copilotkit.ai/settings/billing",
    },
    usage: {
      used: label.length,
      limit: { kind: "finite", value: 100 },
    },
  };
}

function expiryMetadata(expiringSoonCount?: number): InspectorMetadataV1 {
  return {
    schemaVersion: 1,
    plan: { code: "free", label: "Free" },
    usage: {
      used: 148,
      limit: { kind: "finite", value: 200 },
      ...(expiringSoonCount === undefined ? {} : { expiringSoonCount }),
    },
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(value), {
    status,
    headers:
      status === 204 ? undefined : { "content-type": "application/json" },
  });
}

function toHeaderRecord(
  headers: HeadersInit | undefined,
): Record<string, string> {
  if (headers === undefined) {
    return {};
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return { ...headers };
}

function parseBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== "string") {
    return undefined;
  }
  return JSON.parse(body);
}

function runtimeInfo(overrides: RuntimeInfoOverrides): RuntimeInfo {
  return {
    version: "1.0.0",
    agents: {},
    audioFileTranscriptionEnabled: false,
    mode: "sse",
    ...overrides,
  };
}

function setup(options: SetupOptions = {}) {
  const requests: CapturedRequest[] = [];
  const runtimeInfoResponses = [
    ...(options.runtimeInfo ?? [{ inspectorMetadata: true }]),
  ];
  const runtimeInfoFetchResponses = [
    ...(options.runtimeInfoFetchResponses ?? []),
  ];
  const metadataResponses = [...(options.metadataResponses ?? [])];

  vi.stubGlobal("window", {});
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      const body = parseBody(init?.body);
      const request: CapturedRequest = {
        url,
        method: init?.method ?? "GET",
        headers: toHeaderRecord(init?.headers),
        credentials: init?.credentials,
        body,
        signal: init?.signal ?? undefined,
      };
      requests.push(request);

      const isInfoRequest =
        url.endsWith("/info") ||
        (typeof body === "object" &&
          body !== null &&
          "method" in body &&
          body.method === "info");
      if (isInfoRequest) {
        if (runtimeInfoFetchResponses.length > 0) {
          const response = runtimeInfoFetchResponses.shift();
          if (response === undefined) {
            throw new Error(`Missing queued runtime info response: ${url}`);
          }
          return response;
        }
        const info = runtimeInfoResponses.shift();
        if (info === undefined) {
          throw new Error(`Unexpected runtime info request: ${url}`);
        }
        return jsonResponse(runtimeInfo(info));
      }

      const response = metadataResponses.shift();
      if (response === undefined) {
        throw new Error(`Unexpected inspector metadata request: ${url}`);
      }
      return response;
    },
  );
  vi.stubGlobal("fetch", fetchMock);

  const core = new CopilotKitCore({
    runtimeUrl: options.runtimeUrl ?? runtimeOne,
    runtimeTransport: options.runtimeTransport ?? "rest",
    deferInitialConnection: true,
    headers: options.headers,
    credentials: options.credentials,
  });

  return {
    core,
    requests,
    metadataRequests: () =>
      requests.filter(
        (request) =>
          request.url.endsWith("/inspector-metadata") ||
          (typeof request.body === "object" &&
            request.body !== null &&
            "method" in request.body &&
            request.body.method === "inspector/metadata"),
      ),
    infoRequests: () =>
      requests.filter(
        (request) =>
          request.url.endsWith("/info") ||
          (typeof request.body === "object" &&
            request.body !== null &&
            "method" in request.body &&
            request.body.method === "info"),
      ),
    teardown: () => {
      core.setRuntimeUrl(undefined);
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    },
  };
}

test("an absent or false capability never requests inspector metadata", async () => {
  for (const info of [{}, { inspectorMetadata: false }]) {
    const context = setup({ runtimeInfo: [info] });
    const onInspectorMetadataChanged = vi.fn();
    context.core.subscribe({ onInspectorMetadataChanged });
    try {
      context.core.connect();
      await waitFor(
        () =>
          context.core.runtimeConnectionStatus ===
          CopilotKitCoreRuntimeConnectionStatus.Connected,
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(context.metadataRequests()).toHaveLength(0);
      expect(context.core.inspectorMetadata).toBeUndefined();
      expect(onInspectorMetadataChanged).not.toHaveBeenCalled();
    } finally {
      context.teardown();
    }
  }
});

test("a capable runtime updates the getter and subscribers until unsubscribe", async () => {
  const first = metadata("Enterprise");
  const second = metadata("Pro");
  const context = setup({
    metadataResponses: [
      jsonResponse(first),
      jsonResponse({ ...first }),
      jsonResponse(second),
    ],
  });
  const observed: Array<InspectorMetadataV1 | undefined> = [];
  const subscription = context.core.subscribe({
    onInspectorMetadataChanged: ({ inspectorMetadata }) => {
      observed.push(inspectorMetadata);
    },
  });
  try {
    context.core.connect();
    await waitFor(() => context.core.inspectorMetadata !== undefined);

    expect(context.core.inspectorMetadata).toEqual(first);
    expect(observed).toEqual([first]);

    await context.core.refreshInspectorMetadata();

    expect(context.core.inspectorMetadata).toEqual(first);
    expect(observed).toEqual([first]);

    subscription.unsubscribe();
    await context.core.refreshInspectorMetadata();

    expect(context.core.inspectorMetadata).toEqual(second);
    expect(observed).toEqual([first]);
  } finally {
    subscription.unsubscribe();
    context.teardown();
  }
});

test("manual refresh publishes each optional expiry snapshot", async () => {
  const absent = expiryMetadata();
  const zero = expiryMetadata(0);
  const positive = expiryMetadata(37);
  const malformed = {
    schemaVersion: 1,
    plan: { code: "free", label: "Free" },
    usage: {
      used: 148,
      limit: { kind: "finite", value: 200 },
      expiringSoonCount: "37",
    },
  };
  const context = setup({
    metadataResponses: [
      jsonResponse(absent),
      jsonResponse(zero),
      jsonResponse(positive),
      jsonResponse(malformed),
    ],
  });
  const observed: Array<{
    inspectorMetadata: InspectorMetadataV1 | undefined;
    matchesGetter: boolean;
    ownsExpiringSoonCount: boolean;
  }> = [];
  const onInspectorMetadataChanged = vi.fn(
    ({ copilotkit, inspectorMetadata }: InspectorMetadataChangedEvent) => {
      observed.push({
        inspectorMetadata,
        matchesGetter: inspectorMetadata === copilotkit.inspectorMetadata,
        ownsExpiringSoonCount: Object.prototype.hasOwnProperty.call(
          inspectorMetadata?.usage ?? {},
          "expiringSoonCount",
        ),
      });
    },
  );
  const subscription = context.core.subscribe({
    onInspectorMetadataChanged,
  });

  try {
    context.core.connect();
    await waitFor(() => observed.length === 1);

    await context.core.refreshInspectorMetadata();
    await waitFor(() => observed.length === 2);
    await context.core.refreshInspectorMetadata();
    await waitFor(() => observed.length === 3);
    await context.core.refreshInspectorMetadata();
    await waitFor(() => observed.length === 4);

    expect(context.metadataRequests()).toHaveLength(4);
    expect(observed).toStrictEqual([
      {
        inspectorMetadata: absent,
        matchesGetter: true,
        ownsExpiringSoonCount: false,
      },
      {
        inspectorMetadata: zero,
        matchesGetter: true,
        ownsExpiringSoonCount: true,
      },
      {
        inspectorMetadata: positive,
        matchesGetter: true,
        ownsExpiringSoonCount: true,
      },
      {
        inspectorMetadata: absent,
        matchesGetter: true,
        ownsExpiringSoonCount: false,
      },
    ]);
    expect(onInspectorMetadataChanged).toHaveBeenCalledTimes(4);
    expect(onInspectorMetadataChanged).toHaveBeenLastCalledWith({
      copilotkit: context.core,
      inspectorMetadata: context.core.inspectorMetadata,
    });
  } finally {
    subscription.unsubscribe();
    context.teardown();
  }
});

test("metadata notifications keep one immutable snapshot across reentrant subscribers", async () => {
  const initial = metadata("Snapshot");
  const context = setup({ metadataResponses: [jsonResponse(initial)] });
  const firstSubscriber: Array<InspectorMetadataV1 | undefined> = [];
  const secondSubscriber: Array<InspectorMetadataV1 | undefined> = [];
  let disconnected = false;
  context.core.subscribe({
    onInspectorMetadataChanged: ({ inspectorMetadata }) => {
      firstSubscriber.push(inspectorMetadata);
      if (inspectorMetadata !== undefined && !disconnected) {
        disconnected = true;
        context.core.setRuntimeUrl(undefined);
      }
    },
  });
  context.core.subscribe({
    onInspectorMetadataChanged: ({ inspectorMetadata }) => {
      secondSubscriber.push(inspectorMetadata);
    },
  });
  try {
    context.core.connect();
    await waitFor(() => secondSubscriber.length === 2);

    expect(firstSubscriber).toEqual([initial, undefined]);
    expect(secondSubscriber).toEqual([initial, undefined]);
  } finally {
    context.teardown();
  }
});

test("REST and single-route requests forward copied headers and credentials", async () => {
  for (const runtimeTransport of ["rest", "single"] as const) {
    const context = setup({
      runtimeTransport,
      headers: { Authorization: "Bearer secret", "X-Project": "project-1" },
      credentials: "include",
      metadataResponses: [jsonResponse(metadata(runtimeTransport))],
    });
    try {
      context.core.connect();
      await waitFor(() => context.core.inspectorMetadata !== undefined);

      const request = context.metadataRequests()[0];
      expect(request).toBeDefined();
      expect(request?.credentials).toBe("include");
      const forwardedHeaders = new Headers(request?.headers);
      expect(forwardedHeaders.get("authorization")).toBe("Bearer secret");
      expect(forwardedHeaders.get("x-project")).toBe("project-1");
      expect(request?.signal).toBeInstanceOf(AbortSignal);
      if (runtimeTransport === "rest") {
        expect(request).toMatchObject({
          url: `${runtimeOne}/inspector-metadata`,
          method: "GET",
          body: undefined,
        });
      } else {
        expect(request).toMatchObject({
          url: runtimeOne,
          method: "POST",
          body: { method: "inspector/metadata" },
        });
        expect(forwardedHeaders.get("content-type")).toBe("application/json");
      }
    } finally {
      context.teardown();
    }
  }
});

test("single-route requests preserve one caller-supplied lowercase content type", async () => {
  const contentType = "application/vnd.copilotkit.inspector+json";
  const context = setup({
    runtimeTransport: "single",
    headers: { "content-type": contentType },
    metadataResponses: [jsonResponse(metadata("Lowercase Header"))],
  });
  try {
    context.core.connect();
    await waitFor(() => context.core.inspectorMetadata !== undefined);

    expect(context.requests).toHaveLength(2);
    for (const request of context.requests) {
      const contentTypeEntries = Object.entries(request.headers).filter(
        ([name]) => name.toLowerCase() === "content-type",
      );
      expect(contentTypeEntries).toHaveLength(1);
      expect(contentTypeEntries[0]?.[1]).toBe(contentType);
    }
    expect(context.core.headers).toEqual({ "content-type": contentType });
  } finally {
    context.teardown();
  }
});

test("Connected notifications finish before a pending metadata request settles", async () => {
  const pending = deferred<Response>();
  const context = setup({ metadataResponses: [pending.promise] });
  const connectedSnapshots: Array<InspectorMetadataV1 | undefined> = [];
  const requestCountsDuringConnection: number[] = [];
  context.core.subscribe({
    onRuntimeConnectionStatusChanged: ({ copilotkit, status }) => {
      if (status === CopilotKitCoreRuntimeConnectionStatus.Connected) {
        connectedSnapshots.push(copilotkit.inspectorMetadata);
        copilotkit.setHeaders({ Authorization: "Bearer connected" });
        requestCountsDuringConnection.push(context.metadataRequests().length);
      }
    },
    onAgentsChanged: () => {
      requestCountsDuringConnection.push(context.metadataRequests().length);
    },
  });
  try {
    context.core.connect();
    await waitFor(() => context.metadataRequests().length === 1);

    expect(context.core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
    expect(connectedSnapshots).toEqual([undefined]);
    expect(requestCountsDuringConnection.length).toBeGreaterThanOrEqual(2);
    expect(requestCountsDuringConnection.every((count) => count === 0)).toBe(
      true,
    );
    expect(context.core.inspectorMetadata).toBeUndefined();

    pending.resolve(jsonResponse(metadata("Delayed")));
    await waitFor(() => context.core.inspectorMetadata !== undefined);
  } finally {
    context.teardown();
  }
});

test("stale successful auto-detection cannot change the resolved transport after a URL change", async () => {
  const staleInfo = deferred<Response>();
  const currentMetadata = metadata("Current URL Info");
  const context = setup({
    runtimeTransport: "auto",
    runtimeInfoFetchResponses: [
      staleInfo.promise,
      jsonResponse({ error: "no REST route" }, 404),
      jsonResponse(
        runtimeInfo({ version: "new-url", inspectorMetadata: true }),
      ),
    ],
    metadataResponses: [jsonResponse(currentMetadata)],
  });
  const onError = vi.fn();
  context.core.subscribe({ onError });
  try {
    context.core.connect();
    await waitFor(() => context.infoRequests().length === 1);

    context.core.setRuntimeUrl(runtimeTwo);
    await waitFor(
      () =>
        context.core.inspectorMetadata?.plan?.label === "Current URL Info" &&
        context.core.runtimeTransport === "single",
    );
    staleInfo.resolve(
      jsonResponse(
        runtimeInfo({ version: "old-url", inspectorMetadata: true }),
      ),
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(context.core.runtimeUrl).toBe(runtimeTwo);
    expect(context.core.runtimeVersion).toBe("new-url");
    expect(context.core.runtimeTransport).toBe("single");
    expect(context.core.inspectorMetadata).toEqual(currentMetadata);
    expect(onError).not.toHaveBeenCalled();
  } finally {
    context.teardown();
  }
});

test("stale successful auto-detection cannot change a newly requested transport", async () => {
  const staleInfo = deferred<Response>();
  const currentMetadata = metadata("Current Transport Info");
  const context = setup({
    runtimeTransport: "auto",
    runtimeInfoFetchResponses: [
      staleInfo.promise,
      jsonResponse(
        runtimeInfo({ version: "new-transport", inspectorMetadata: true }),
      ),
    ],
    metadataResponses: [jsonResponse(currentMetadata)],
  });
  try {
    context.core.connect();
    await waitFor(() => context.infoRequests().length === 1);

    context.core.setRuntimeTransport("single");
    await waitFor(
      () =>
        context.core.inspectorMetadata?.plan?.label ===
          "Current Transport Info" &&
        context.core.runtimeTransport === "single",
    );
    staleInfo.resolve(
      jsonResponse(
        runtimeInfo({ version: "old-transport", inspectorMetadata: true }),
      ),
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(context.core.runtimeVersion).toBe("new-transport");
    expect(context.core.runtimeTransport).toBe("single");
    expect(context.core.inspectorMetadata).toEqual(currentMetadata);
  } finally {
    context.teardown();
  }
});

test("a stale rejected runtime-info request cannot corrupt a newer URL connection", async () => {
  const staleInfo = deferred<Response>();
  const currentMetadata = metadata("Current URL Rejection");
  const context = setup({
    runtimeTransport: "rest",
    runtimeInfoFetchResponses: [
      staleInfo.promise,
      jsonResponse(
        runtimeInfo({ version: "new-url", inspectorMetadata: true }),
      ),
    ],
    metadataResponses: [jsonResponse(currentMetadata)],
  });
  const onError = vi.fn();
  context.core.subscribe({ onError });
  try {
    context.core.connect();
    await waitFor(() => context.infoRequests().length === 1);

    context.core.setRuntimeUrl(runtimeTwo);
    await waitFor(
      () =>
        context.core.inspectorMetadata?.plan?.label === "Current URL Rejection",
    );
    staleInfo.reject(new Error("old URL info failed"));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(context.core.runtimeUrl).toBe(runtimeTwo);
    expect(context.core.runtimeVersion).toBe("new-url");
    expect(context.core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
    expect(context.core.inspectorMetadata).toEqual(currentMetadata);
    expect(onError).not.toHaveBeenCalled();
  } finally {
    context.teardown();
  }
});

test("a stale rejected auto-fallback cannot corrupt a newly requested transport", async () => {
  const staleInfo = deferred<Response>();
  const currentMetadata = metadata("Current Transport Rejection");
  const context = setup({
    runtimeTransport: "auto",
    runtimeInfoFetchResponses: [
      jsonResponse({ error: "no REST route" }, 404),
      staleInfo.promise,
      jsonResponse(
        runtimeInfo({ version: "new-transport", inspectorMetadata: true }),
      ),
    ],
    metadataResponses: [jsonResponse(currentMetadata)],
  });
  const onError = vi.fn();
  context.core.subscribe({ onError });
  try {
    context.core.connect();
    await waitFor(() => context.infoRequests().length === 2);

    context.core.setRuntimeTransport("rest");
    await waitFor(
      () =>
        context.core.inspectorMetadata?.plan?.label ===
        "Current Transport Rejection",
    );
    staleInfo.reject(new Error("old auto fallback failed"));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(context.core.runtimeVersion).toBe("new-transport");
    expect(context.core.runtimeTransport).toBe("rest");
    expect(context.core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
    expect(context.core.inspectorMetadata).toEqual(currentMetadata);
    expect(onError).not.toHaveBeenCalled();
  } finally {
    context.teardown();
  }
});

test("optional-route failures and invalid bodies stay connected with absent metadata", async () => {
  const cases: Array<{ name: string; response: Response }> = [
    { name: "204", response: jsonResponse(undefined, 204) },
    { name: "404", response: jsonResponse({ error: "missing" }, 404) },
    { name: "500", response: jsonResponse({ error: "failed" }, 500) },
    {
      name: "invalid JSON",
      response: new Response("{", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    },
    { name: "invalid payload", response: jsonResponse([]) },
    { name: "unknown schema", response: jsonResponse({ schemaVersion: 2 }) },
  ];

  for (const testCase of cases) {
    const context = setup({ metadataResponses: [testCase.response] });
    const onError = vi.fn();
    context.core.subscribe({ onError });
    try {
      context.core.connect();
      await waitFor(() => context.metadataRequests().length === 1);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(context.core.runtimeConnectionStatus, testCase.name).toBe(
        CopilotKitCoreRuntimeConnectionStatus.Connected,
      );
      expect(context.core.inspectorMetadata, testCase.name).toBeUndefined();
      expect(onError, testCase.name).not.toHaveBeenCalled();
    } finally {
      context.teardown();
    }
  }
});

test("stalled REST and single-route metadata requests time out as absent", async () => {
  for (const runtimeTransport of ["rest", "single"] as const) {
    const stalled = deferred<Response>();
    const context = setup({
      runtimeTransport,
      metadataResponses: [jsonResponse(metadata("Loaded")), stalled.promise],
    });
    const onError = vi.fn();
    context.core.subscribe({ onError });
    try {
      context.core.connect();
      await waitFor(
        () => context.core.inspectorMetadata?.plan?.label === "Loaded",
      );
      vi.useFakeTimers();
      const timerCountBeforeRefresh = vi.getTimerCount();
      let refreshSettled = false;

      const refresh = context.core.refreshInspectorMetadata().then(() => {
        refreshSettled = true;
      });
      expect(context.metadataRequests()).toHaveLength(2);
      const signal = context.metadataRequests()[1]?.signal;

      await vi.advanceTimersByTimeAsync(5_000);
      await Promise.resolve();

      expect(refreshSettled, runtimeTransport).toBe(true);
      await refresh;
      expect(signal?.aborted, runtimeTransport).toBe(true);
      expect(context.core.inspectorMetadata, runtimeTransport).toBeUndefined();
      expect(context.core.runtimeConnectionStatus, runtimeTransport).toBe(
        CopilotKitCoreRuntimeConnectionStatus.Connected,
      );
      expect(onError, runtimeTransport).not.toHaveBeenCalled();
      expect(vi.getTimerCount(), runtimeTransport).toBe(
        timerCountBeforeRefresh,
      );
    } finally {
      vi.useRealTimers();
      context.teardown();
    }
  }
});

test("manual refresh replaces current metadata", async () => {
  const first = metadata("Initial");
  const second = metadata("Refreshed");
  const context = setup({
    metadataResponses: [jsonResponse(first), jsonResponse(second)],
  });
  try {
    context.core.connect();
    await waitFor(() => context.core.inspectorMetadata !== undefined);

    await context.core.refreshInspectorMetadata();

    expect(context.core.inspectorMetadata).toEqual(second);
    expect(context.metadataRequests()).toHaveLength(2);
  } finally {
    context.teardown();
  }
});

test("header and credential changes refresh metadata without rediscovery", async () => {
  const context = setup({
    headers: { Authorization: "Bearer one" },
    credentials: "same-origin",
    metadataResponses: [
      jsonResponse(metadata("Initial")),
      jsonResponse(metadata("Headers")),
      jsonResponse(metadata("Credentials")),
    ],
  });
  try {
    context.core.connect();
    await waitFor(
      () => context.core.inspectorMetadata?.plan?.label === "Initial",
    );

    context.core.setHeaders({ Authorization: "Bearer two" });
    await waitFor(
      () => context.core.inspectorMetadata?.plan?.label === "Headers",
    );

    context.core.setCredentials("include");
    await waitFor(
      () => context.core.inspectorMetadata?.plan?.label === "Credentials",
    );

    expect(context.infoRequests()).toHaveLength(1);
    expect(context.metadataRequests()).toHaveLength(3);
    expect(context.metadataRequests()[1]).toMatchObject({
      headers: { Authorization: "Bearer two" },
      credentials: "same-origin",
    });
    expect(context.metadataRequests()[2]).toMatchObject({
      headers: { Authorization: "Bearer two" },
      credentials: "include",
    });
  } finally {
    context.teardown();
  }
});

test("auth context changes clear loaded metadata before stalled refreshes settle", async () => {
  for (const authContext of ["headers", "credentials"] as const) {
    const stalled = deferred<Response>();
    const initial = metadata(`Initial ${authContext}`);
    const context = setup({
      headers: { Authorization: "Bearer one" },
      credentials: "same-origin",
      metadataResponses: [jsonResponse(initial), stalled.promise],
    });
    try {
      context.core.connect();
      await waitFor(
        () =>
          context.core.inspectorMetadata?.plan?.label ===
          `Initial ${authContext}`,
      );

      if (authContext === "headers") {
        context.core.setHeaders({ Authorization: "Bearer two" });
      } else {
        context.core.setCredentials("include");
      }

      expect(context.core.inspectorMetadata, authContext).toBeUndefined();
      expect(context.core.runtimeConnectionStatus, authContext).toBe(
        CopilotKitCoreRuntimeConnectionStatus.Connected,
      );
      expect(context.metadataRequests(), authContext).toHaveLength(2);
      expect(context.metadataRequests()[1]?.signal?.aborted, authContext).toBe(
        false,
      );
    } finally {
      context.teardown();
    }
  }
});

test("a stale metadata result cannot cross a runtime URL change", async () => {
  const stale = deferred<Response>();
  const current = metadata("Current URL");
  const context = setup({
    runtimeInfo: [{ inspectorMetadata: true }, { inspectorMetadata: true }],
    metadataResponses: [stale.promise, jsonResponse(current)],
  });
  try {
    context.core.connect();
    await waitFor(() => context.metadataRequests().length === 1);

    context.core.setRuntimeUrl(runtimeTwo);
    await waitFor(
      () => context.core.inspectorMetadata?.plan?.label === "Current URL",
    );
    stale.resolve(jsonResponse(metadata("Stale URL")));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(context.core.inspectorMetadata).toEqual(current);
    expect(context.metadataRequests()[1]?.url).toBe(
      `${runtimeTwo}/inspector-metadata`,
    );
  } finally {
    context.teardown();
  }
});

test("a stale metadata result cannot cross requested or resolved transport changes", async () => {
  const stale = deferred<Response>();
  const current = metadata("Single");
  const context = setup({
    runtimeTransport: "auto",
    runtimeInfo: [{ inspectorMetadata: true }, { inspectorMetadata: true }],
    metadataResponses: [stale.promise, jsonResponse(current)],
  });
  try {
    context.core.connect();
    await waitFor(() => context.metadataRequests().length === 1);
    expect(context.core.runtimeTransport).toBe("rest");

    context.core.setRuntimeTransport("single");
    await waitFor(
      () => context.core.inspectorMetadata?.plan?.label === "Single",
    );
    stale.resolve(jsonResponse(metadata("Stale REST")));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(context.core.runtimeTransport).toBe("single");
    expect(context.core.inspectorMetadata).toEqual(current);
    expect(context.metadataRequests()[1]).toMatchObject({
      url: runtimeOne,
      method: "POST",
      body: { method: "inspector/metadata" },
    });
  } finally {
    context.teardown();
  }
});

test("stale header and credential generations cannot overwrite newer metadata", async () => {
  const staleHeaders = deferred<Response>();
  const staleCredentials = deferred<Response>();
  const context = setup({
    metadataResponses: [
      jsonResponse(metadata("Initial")),
      staleHeaders.promise,
      jsonResponse(metadata("Latest Headers")),
      staleCredentials.promise,
      jsonResponse(metadata("Latest Credentials")),
    ],
  });
  try {
    context.core.connect();
    await waitFor(
      () => context.core.inspectorMetadata?.plan?.label === "Initial",
    );

    context.core.setHeaders({ Authorization: "Bearer stale" });
    await waitFor(() => context.metadataRequests().length === 2);
    context.core.setHeaders({ Authorization: "Bearer latest" });
    await waitFor(
      () => context.core.inspectorMetadata?.plan?.label === "Latest Headers",
    );
    staleHeaders.resolve(jsonResponse({ error: "stale failure" }, 500));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    context.core.setCredentials("same-origin");
    await waitFor(() => context.metadataRequests().length === 4);
    context.core.setCredentials("include");
    await waitFor(
      () =>
        context.core.inspectorMetadata?.plan?.label === "Latest Credentials",
    );
    staleCredentials.reject(new Error("stale credential fetch failed"));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(context.core.inspectorMetadata?.plan?.label).toBe(
      "Latest Credentials",
    );
    expect(context.infoRequests()).toHaveLength(1);
  } finally {
    context.teardown();
  }
});

test("disconnect aborts and clears metadata while ignored aborts stay stale", async () => {
  const stale = deferred<Response>();
  const context = setup({
    metadataResponses: [jsonResponse(metadata("Loaded")), stale.promise],
  });
  try {
    context.core.connect();
    await waitFor(
      () => context.core.inspectorMetadata?.plan?.label === "Loaded",
    );
    const refresh = context.core.refreshInspectorMetadata();
    await waitFor(() => context.metadataRequests().length === 2);
    const signal = context.metadataRequests()[1]?.signal;

    context.core.setRuntimeUrl(undefined);

    expect(signal?.aborted).toBe(true);
    expect(context.core.inspectorMetadata).toBeUndefined();
    stale.resolve(jsonResponse(metadata("After Disconnect")));
    await refresh;

    expect(context.core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Disconnected,
    );
    expect(context.core.inspectorMetadata).toBeUndefined();
  } finally {
    context.teardown();
  }
});

test("capability removal clears metadata and rejects in-flight stale success or failure", async () => {
  for (const staleResponse of [
    jsonResponse(metadata("Stale Success")),
    jsonResponse({ error: "stale failure" }, 500),
  ]) {
    const stale = deferred<Response>();
    const context = setup({
      runtimeInfo: [{ inspectorMetadata: true }, { inspectorMetadata: false }],
      metadataResponses: [jsonResponse(metadata("Licensed")), stale.promise],
    });
    const observed: Array<InspectorMetadataV1 | undefined> = [];
    context.core.subscribe({
      onInspectorMetadataChanged: ({ inspectorMetadata }) => {
        observed.push(inspectorMetadata);
      },
    });
    try {
      context.core.connect();
      await waitFor(() => context.core.inspectorMetadata !== undefined);
      const refresh = context.core.refreshInspectorMetadata();
      await waitFor(() => context.metadataRequests().length === 2);

      context.core.setRuntimeUrl(runtimeTwo);
      await waitFor(
        () =>
          context.core.runtimeConnectionStatus ===
            CopilotKitCoreRuntimeConnectionStatus.Connected &&
          context.infoRequests().length === 2,
      );

      expect(context.core.inspectorMetadata).toBeUndefined();
      stale.resolve(staleResponse);
      await refresh;

      expect(context.core.inspectorMetadata).toBeUndefined();
      expect(context.metadataRequests()).toHaveLength(2);
      expect(observed).toEqual([metadata("Licensed"), undefined]);
    } finally {
      context.teardown();
    }
  }
});

test("metadata subscriber failures do not break connection or later refreshes", async () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  const context = setup({
    metadataResponses: [
      jsonResponse(metadata("Initial")),
      jsonResponse(metadata("Refreshed")),
    ],
  });
  context.core.subscribe({
    onInspectorMetadataChanged: () => {
      throw new Error("subscriber failed");
    },
  });
  try {
    context.core.connect();
    await waitFor(
      () => context.core.inspectorMetadata?.plan?.label === "Initial",
    );

    await expect(
      context.core.refreshInspectorMetadata(),
    ).resolves.toBeUndefined();

    expect(context.core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
    expect(context.core.inspectorMetadata?.plan?.label).toBe("Refreshed");
    expect(consoleError).toHaveBeenCalled();
  } finally {
    context.teardown();
  }
});
