import type { RuntimeEntitlementResponse } from "@copilotkit/shared";
import { expect, test, vi } from "vitest";
import { CopilotKitIntelligence } from "../client";

const ACTIVE_ENTITLEMENTS = {
  status: "ready",
  entitlement: {
    active: true,
    source: "managedOrgSubscription",
    features: { threads: true },
    limits: {},
  },
} as const satisfies RuntimeEntitlementResponse;

const ACTIVE_ENTITLEMENTS_TRANSPORT = {
  organizationId: "org-private",
  active: true,
  source: "managedOrgSubscription",
  features: { threads: true },
  limits: {},
} as const;

const INACTIVE_ENTITLEMENTS_TRANSPORT = {
  organizationId: "org-private",
  active: false,
  source: "managedOrgSubscription",
  features: {},
  limits: {},
} as const;

/** Install a private fetch mock and return an entitlement client plus cleanup. */
function setup() {
  const fetchMock = vi.fn(() =>
    Promise.resolve(Response.json(ACTIVE_ENTITLEMENTS_TRANSPORT)),
  );
  vi.stubGlobal("fetch", fetchMock);
  const client = new CopilotKitIntelligence({
    apiKey: "test-api-key",
    apiUrl: "https://runtime.example",
    wsUrl: "wss://runtime.example",
  });

  return {
    client,
    fetchMock,
    teardown: () => vi.unstubAllGlobals(),
  };
}

test("shares one in-flight Runtime entitlement lookup per client", async () => {
  const { client, fetchMock, teardown } = setup();

  try {
    const [first, second] = await Promise.all([
      client.getRuntimeEntitlements(),
      client.getRuntimeEntitlements(),
    ]);

    expect(first).toEqual(ACTIVE_ENTITLEMENTS);
    expect(second).toEqual(ACTIVE_ENTITLEMENTS);
    expect(first).not.toBe(second);
    if (first.status === "ready" && second.status === "ready") {
      expect(first.entitlement).not.toBe(second.entitlement);
      expect(first.entitlement.features).not.toBe(second.entitlement.features);
      expect(first.entitlement.limits).not.toBe(second.entitlement.limits);
    }
    expect(fetchMock).toHaveBeenCalledOnce();
  } finally {
    teardown();
  }
});

test("isolates cached Runtime entitlements from caller mutation", async () => {
  const { client, fetchMock, teardown } = setup();

  try {
    const first = await client.getRuntimeEntitlements();
    expect(first.status).toBe("ready");
    if (first.status !== "ready") {
      throw new Error("Expected a ready Runtime entitlement");
    }
    first.entitlement.active = false;
    first.entitlement.features.threads = false;
    first.entitlement.limits.forged = 1;

    const second = await client.getRuntimeEntitlements();

    expect(second).toEqual(ACTIVE_ENTITLEMENTS);
    expect(second).not.toBe(first);
    expect(fetchMock).toHaveBeenCalledOnce();
  } finally {
    teardown();
  }
});

test("caches active Runtime entitlements for a bounded success TTL", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-22T00:00:00.000Z"));
  const { client, fetchMock, teardown } = setup();

  try {
    await client.getRuntimeEntitlements();
    await vi.advanceTimersByTimeAsync(29_999);
    await client.getRuntimeEntitlements();

    expect(fetchMock).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    await client.getRuntimeEntitlements();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally {
    teardown();
    vi.useRealTimers();
  }
});

test("uses a shorter negative TTL for inactive Runtime entitlements", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-22T00:00:00.000Z"));
  const { client, fetchMock, teardown } = setup();
  fetchMock.mockImplementation(() =>
    Promise.resolve(Response.json(INACTIVE_ENTITLEMENTS_TRANSPORT)),
  );

  try {
    await client.getRuntimeEntitlements();
    await vi.advanceTimersByTimeAsync(4_999);
    await client.getRuntimeEntitlements();

    expect(fetchMock).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    await client.getRuntimeEntitlements();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally {
    teardown();
    vi.useRealTimers();
  }
});

test("backs off repeated failed Runtime entitlement lookups", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-22T00:00:00.000Z"));
  const { client, fetchMock, teardown } = setup();
  fetchMock
    .mockRejectedValueOnce(new Error("temporary dependency failure"))
    .mockImplementation(() =>
      Promise.resolve(Response.json(ACTIVE_ENTITLEMENTS_TRANSPORT)),
    );

  try {
    await expect(client.getRuntimeEntitlements()).rejects.toMatchObject({
      message: "Runtime entitlement request failed",
      status: 502,
    });
    await expect(client.getRuntimeEntitlements()).rejects.toMatchObject({
      message: "Runtime entitlement request failed",
      status: 502,
    });
    expect(fetchMock).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(4_999);
    await expect(client.getRuntimeEntitlements()).rejects.toMatchObject({
      status: 502,
    });
    expect(fetchMock).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);

    await expect(client.getRuntimeEntitlements()).resolves.toEqual(
      ACTIVE_ENTITLEMENTS,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally {
    teardown();
    vi.useRealTimers();
  }
});

test("isolates cached Runtime entitlement errors from caller mutation", async () => {
  const { client, fetchMock, teardown } = setup();
  fetchMock.mockRejectedValueOnce(new Error("temporary dependency failure"));

  try {
    const first = await client
      .getRuntimeEntitlements()
      .catch((error: unknown) => error);
    expect(first).toMatchObject({
      message: "Runtime entitlement request failed",
      status: 502,
      retryable: true,
    });
    Object.assign(first as object, {
      message: "forged success",
      status: 200,
      retryable: false,
    });

    const second = await client
      .getRuntimeEntitlements()
      .catch((error: unknown) => error);

    expect(second).toMatchObject({
      message: "Runtime entitlement request failed",
      status: 502,
      retryable: true,
    });
    expect(second).not.toBe(first);
    expect(fetchMock).toHaveBeenCalledOnce();
  } finally {
    teardown();
  }
});

test("backs off a failed refresh of an expired inactive entitlement", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-22T00:00:00.000Z"));
  const { client, fetchMock, teardown } = setup();
  fetchMock
    .mockImplementationOnce(() =>
      Promise.resolve(Response.json(INACTIVE_ENTITLEMENTS_TRANSPORT)),
    )
    .mockRejectedValueOnce(new Error("temporary dependency failure"));

  try {
    await client.getRuntimeEntitlements();
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(client.getRuntimeEntitlements()).rejects.toMatchObject({
      message: "Runtime entitlement request failed",
      status: 502,
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await expect(client.getRuntimeEntitlements()).rejects.toMatchObject({
      message: "Runtime entitlement request failed",
      status: 502,
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(5_000);
    await expect(client.getRuntimeEntitlements()).resolves.toEqual(
      ACTIVE_ENTITLEMENTS,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  } finally {
    teardown();
    vi.useRealTimers();
  }
});

test("never serves an expired access grant when its refresh fails", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-22T00:00:00.000Z"));
  const { client, fetchMock, teardown } = setup();

  try {
    await client.getRuntimeEntitlements();
    fetchMock.mockRejectedValueOnce(new Error("temporary dependency failure"));
    await vi.advanceTimersByTimeAsync(30_000);

    await expect(client.getRuntimeEntitlements()).rejects.toMatchObject({
      message: "Runtime entitlement request failed",
      status: 502,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await expect(client.getRuntimeEntitlements()).rejects.toMatchObject({
      status: 502,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(5_000);
    await expect(client.getRuntimeEntitlements()).resolves.toEqual(
      ACTIVE_ENTITLEMENTS,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  } finally {
    teardown();
    vi.useRealTimers();
  }
});
