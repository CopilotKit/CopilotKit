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

const INACTIVE_ENTITLEMENTS = {
  status: "ready",
  entitlement: {
    active: false,
    source: "managedOrgSubscription",
    features: {},
    limits: {},
  },
} as const satisfies RuntimeEntitlementResponse;

/** Install a private fetch mock and return an entitlement client plus cleanup. */
function setup() {
  const fetchMock = vi.fn(() =>
    Promise.resolve(Response.json(ACTIVE_ENTITLEMENTS)),
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
    Promise.resolve(Response.json(INACTIVE_ENTITLEMENTS)),
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
      Promise.resolve(Response.json(ACTIVE_ENTITLEMENTS)),
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

test("serves an expired deny result when its refresh fails", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-22T00:00:00.000Z"));
  const { client, fetchMock, teardown } = setup();
  fetchMock
    .mockImplementationOnce(() =>
      Promise.resolve(Response.json(INACTIVE_ENTITLEMENTS)),
    )
    .mockRejectedValueOnce(new Error("temporary dependency failure"));

  try {
    await client.getRuntimeEntitlements();
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(client.getRuntimeEntitlements()).resolves.toEqual(
      INACTIVE_ENTITLEMENTS,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await expect(client.getRuntimeEntitlements()).resolves.toEqual(
      INACTIVE_ENTITLEMENTS,
    );
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
