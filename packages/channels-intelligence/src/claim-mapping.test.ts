import { describe, it, expect } from "vitest";
import {
  conversationKeyFromReplyTarget,
  mapDeliveryToEnvelope,
} from "./claim-mapping.js";
import type { ClaimedDelivery } from "./claim-mapping.js";

const baseDelivery = (
  overrides: Partial<ClaimedDelivery["turn"]> = {},
): ClaimedDelivery => ({
  id: "dlv_1",
  organizationId: "org_1",
  projectId: 7,
  channel: { id: "channel_1", name: "support" },
  adapter: "slack",
  leaseToken: "lease_1",
  turn: {
    id: "turn_1",
    eventId: "evt_1",
    replyTarget: {
      adapter: "slack",
      teamId: "T1",
      channel: "C1",
      threadTs: "9.9",
    },
    ...overrides,
  },
});

describe("conversationKeyFromReplyTarget", () => {
  it("keys Slack by team+channel+thread (thread-stable, not per-turn)", () => {
    expect(
      conversationKeyFromReplyTarget({
        adapter: "slack",
        teamId: "T1",
        channel: "C1",
        threadTs: "1700.1",
      }),
    ).toBe("slack:T1:C1:thread:1700.1");
  });

  it("keys a root-level Slack message under `root`", () => {
    expect(
      conversationKeyFromReplyTarget({
        adapter: "slack",
        teamId: "T1",
        channel: "C1",
      }),
    ).toBe("slack:T1:C1:thread:root");
  });

  it("keys Teams by tenant+conversation (matching app-api thread_key)", () => {
    expect(
      conversationKeyFromReplyTarget({
        adapter: "teams",
        serviceUrl: "https://smba",
        conversationId: "conv1",
        tenantId: "tenantA",
      }),
    ).toBe("teams:tenantA:conv1");
  });

  it("fails loud on an unmodeled adapter rather than colliding conversations", () => {
    expect(() =>
      conversationKeyFromReplyTarget({
        adapter: "discord",
      } as unknown as Parameters<typeof conversationKeyFromReplyTarget>[0]),
    ).toThrow(/unsupported reply-target adapter/);
  });
});

describe("mapDeliveryToEnvelope — identity (OSS-476)", () => {
  it("maps the provider actor to env.user (id + displayName)", () => {
    const env = mapDeliveryToEnvelope(
      baseDelivery({
        actor: { externalUserId: "U123", displayName: "Ada" },
        input: { kind: "text", text: "hi" },
      }),
    );
    expect(env.user).toEqual({ id: "U123", displayName: "Ada" });
  });

  it("omits displayName when the actor has none", () => {
    const env = mapDeliveryToEnvelope(
      baseDelivery({ actor: { externalUserId: "U123" } }),
    );
    expect(env.user).toEqual({ id: "U123" });
  });

  it("omits user entirely when the claim carries no actor", () => {
    const env = mapDeliveryToEnvelope(baseDelivery());
    expect(env.user).toBeUndefined();
  });

  it("derives a thread-stable conversationKey from the reply target", () => {
    const env = mapDeliveryToEnvelope(baseDelivery());
    expect(env.conversationKey).toBe("slack:T1:C1:thread:9.9");
  });
});

describe("mapDeliveryToEnvelope — kind discrimination (OSS-476)", () => {
  it("preserves a command turn instead of coercing it to text", () => {
    const env = mapDeliveryToEnvelope(
      baseDelivery({
        input: {
          kind: "command",
          command: "/deploy",
          text: "prod",
          triggerId: "tr1",
        },
      }),
    );
    expect(env.kind).toBe("command");
    expect(env).toMatchObject({
      command: "/deploy",
      text: "prod",
      triggerId: "tr1",
    });
  });

  it("preserves a reaction turn", () => {
    const env = mapDeliveryToEnvelope(
      baseDelivery({
        input: {
          kind: "reaction",
          rawEmoji: "eyes",
          added: true,
          messageId: "m1",
        },
      }),
    );
    expect(env.kind).toBe("reaction");
    expect(env).toMatchObject({
      rawEmoji: "eyes",
      added: true,
      messageId: "m1",
    });
  });

  it("preserves an interaction turn", () => {
    const env = mapDeliveryToEnvelope(
      baseDelivery({
        input: { kind: "interaction", actionId: "ck:approve", value: "yes" },
      }),
    );
    expect(env.kind).toBe("interaction");
    expect(env).toMatchObject({ actionId: "ck:approve", value: "yes" });
  });

  it("maps a text (or absent) input to a turn", () => {
    expect(mapDeliveryToEnvelope(baseDelivery({ input: undefined })).kind).toBe(
      "turn",
    );
    const env = mapDeliveryToEnvelope(
      baseDelivery({ input: { kind: "text", text: "hello" } }),
    );
    expect(env.kind).toBe("turn");
    expect(env).toMatchObject({ text: "hello" });
  });
});

describe("mapDeliveryToEnvelope — canonical identity + scope (OSS-643)", () => {
  it("carries the canonical appUserId without re-deriving it", () => {
    const env = mapDeliveryToEnvelope(
      baseDelivery({
        actor: {
          externalUserId: "U123",
          appUserId: "slack:T1:U123",
          displayName: "Ada",
        },
      }),
    );
    expect(env.user).toEqual({
      id: "U123",
      appUserId: "slack:T1:U123",
      displayName: "Ada",
    });
  });

  it("keeps user.id as the RAW provider id so provider APIs still work", () => {
    // Mentions, users.info, and every other Slack/Teams call need the raw id.
    // The canonical id rides alongside; it never replaces it.
    const env = mapDeliveryToEnvelope(
      baseDelivery({
        actor: { externalUserId: "U123", appUserId: "slack:T1:U123" },
      }),
    );
    expect(env.user?.id).toBe("U123");
  });

  it("omits appUserId when app-api could not scope the identity", () => {
    // e.g. an adapter config with no provider_team_id — app-api declines to
    // emit an id that would collide across workspaces rather than guessing.
    const env = mapDeliveryToEnvelope(
      baseDelivery({ actor: { externalUserId: "U123" } }),
    );
    expect(env.user).toEqual({ id: "U123" });
    expect(env.user).not.toHaveProperty("appUserId");
  });

  it("passes an explicit direct scope through", () => {
    const env = mapDeliveryToEnvelope(
      baseDelivery({ conversationScope: "direct" }),
    );
    expect(env.conversationScope).toBe("direct");
  });

  it("coalesces a malformed claim with no scope to shared", () => {
    // app-api owns the fail-closed default and always sends a scope; this
    // guards the privacy gate against `undefined` reaching it regardless.
    const env = mapDeliveryToEnvelope(
      baseDelivery({ conversationScope: undefined }),
    );
    expect(env.conversationScope).toBe("shared");
  });
});
