import { expect, test, vi } from "vitest";
import {
  channelActorIdentity,
  ChannelIdentityResolutionError,
  ChannelIdentityResultError,
  resolveChannelUser,
} from "./identity.js";
import type { ChannelIdentityContext } from "./identity.js";

function context(
  kind: ChannelIdentityContext["actor"]["kind"] = "human",
): ChannelIdentityContext {
  return {
    provider: "slack",
    tenant: { id: "T1", name: "Acme" },
    installation: { id: "I1" },
    actor: {
      id: "U1",
      kind,
      name: "Ada Lovelace",
      handle: "ada",
    },
    conversation: { id: "C1", kind: "channel" },
    trigger: "message",
    event: { id: "E1" },
    raw: { type: "app_mention" },
  };
}

test("platform identity maps a human actor to a tenant-namespaced application user", async () => {
  await expect(resolveChannelUser("platform", context())).resolves.toEqual({
    id: "slack:T1:U1",
    name: "Ada Lovelace",
  });
});

test("platform identity keeps provider and tenant namespaces distinct", async () => {
  const slack = context();
  const otherTenant = { ...context(), tenant: { id: "T2" } };
  const teams = { ...context(), provider: "teams" };

  await expect(resolveChannelUser("platform", slack)).resolves.toMatchObject({
    id: "slack:T1:U1",
  });
  await expect(
    resolveChannelUser("platform", otherTenant),
  ).resolves.toMatchObject({ id: "slack:T2:U1" });
  await expect(resolveChannelUser("platform", teams)).resolves.toMatchObject({
    id: "teams:T1:U1",
  });
});

test.each(["bot", "app", "system", "unknown"] as const)(
  "platform identity maps a %s actor to null",
  async (kind) => {
    await expect(
      resolveChannelUser("platform", context(kind)),
    ).resolves.toBeNull();
  },
);

test("platform identity falls back from name to handle and provider id", async () => {
  const withHandle = {
    ...context(),
    actor: { id: "U1", kind: "human" as const, handle: "ada" },
  };
  await expect(
    resolveChannelUser("platform", withHandle),
  ).resolves.toMatchObject({
    name: "ada",
  });

  const withId = {
    ...context(),
    actor: { id: "U1", kind: "human" as const },
  };
  await expect(resolveChannelUser("platform", withId)).resolves.toMatchObject({
    name: "U1",
  });
});

test("a custom identity callback may map a bot actor", async () => {
  const botContext = context("bot");
  await expect(
    resolveChannelUser(
      () => ({ id: "service-1", name: "Build bot" }),
      botContext,
    ),
  ).resolves.toEqual({ id: "service-1", name: "Build bot" });
});

test.each([
  undefined,
  {},
  { id: "", name: "Ada" },
  { id: "person-1", name: "" },
])(
  "a malformed custom identity result fails with the stable public error",
  async (result) => {
    await expect(
      resolveChannelUser(() => result as never, context()),
    ).rejects.toMatchObject({
      code: "channel_identity_invalid",
      name: new ChannelIdentityResultError().name,
    });
  },
);

test("a thrown custom identity error uses a stable public failure without platform fallback", async () => {
  const failure = new Error("identity service unavailable");
  const result = resolveChannelUser(() => {
    throw failure;
  }, context());

  await expect(result).rejects.toMatchObject({
    code: "channel_identity_failed",
    cause: failure,
  });
  await expect(result).rejects.toBeInstanceOf(ChannelIdentityResolutionError);
});

test("profile lookup stays lazy unless the custom callback calls it", async () => {
  const lookupProfile = vi.fn(async () => ({
    id: "U1",
    kind: "human" as const,
    email: "ada@example.com",
  }));
  const identityContext = { ...context(), lookupProfile };

  await resolveChannelUser("platform", identityContext);
  expect(lookupProfile).not.toHaveBeenCalled();

  await resolveChannelUser(async (received) => {
    const profile = await received.lookupProfile?.();
    return { id: "person-1", name: profile?.email ?? "Ada" };
  }, identityContext);
  expect(lookupProfile).toHaveBeenCalledTimes(1);
});

test("a failing lazy profile lookup cannot break platform identity", async () => {
  const lookupProfile = vi.fn(async () => {
    throw new Error("provider profile unavailable");
  });
  const identityContext = {
    ...context(),
    actor: { id: "U1", kind: "human" as const },
    lookupProfile,
  };

  await expect(
    resolveChannelUser("platform", identityContext),
  ).resolves.toEqual({ id: "slack:T1:U1", name: "U1" });
  expect(lookupProfile).not.toHaveBeenCalled();
});

test("channelActorIdentity names the actor and the platform that scopes them", () => {
  expect(
    channelActorIdentity(
      { id: "U1", kind: "human", name: "Ada", handle: "ada", email: "a@b.c" },
      "slack",
    ),
  ).toEqual({
    id: "U1",
    kind: "human",
    platform: "slack",
    name: "Ada",
    handle: "ada",
    email: "a@b.c",
  });
});

test("channelActorIdentity omits display fields the provider did not report", () => {
  expect(channelActorIdentity({ id: "U1", kind: "human" }, "slack")).toEqual({
    id: "U1",
    kind: "human",
    platform: "slack",
  });
});

test("channelActorIdentity passes an id through unaltered", () => {
  // A Teams id carries a colon, and adapters bound an actor id only by length.
  // Reshaping it to suit a model provider's author charset would answer as
  // somebody else, so nothing here rewrites it.
  expect(
    channelActorIdentity({ id: "29:1a2b3c", kind: "human" }, "teams")?.id,
  ).toBe("29:1a2b3c");
});

test("channelActorIdentity reports nobody when the ingress named nobody", () => {
  expect(
    channelActorIdentity({ id: "", kind: "unknown" }, "slack"),
  ).toBeUndefined();
  expect(channelActorIdentity(undefined, "slack")).toBeUndefined();
});
