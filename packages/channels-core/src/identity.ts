import type { ApplicationUser, ProviderActor } from "@copilotkit/channels-ui";

/** Provider tenant or workspace facts available at ingress. */
export interface ChannelTenant {
  readonly id: string;
  readonly name?: string;
}

/** Provider installation facts available at ingress. */
export interface ChannelInstallation {
  readonly id: string;
}

/** Provider conversation facts available at ingress. */
export interface ChannelConversation {
  readonly id: string;
  readonly kind?: string;
}

/** Normalized provider event facts available at ingress. */
export interface ChannelEvent {
  readonly id?: string;
  readonly occurredAt?: string;
  readonly [key: string]: unknown;
}

/** Adapter-provided facts used to select one canonical application user. */
export interface ChannelIdentityContext {
  readonly provider: string;
  readonly tenant: ChannelTenant;
  readonly installation: ChannelInstallation;
  readonly actor: ProviderActor;
  readonly conversation: ChannelConversation;
  readonly trigger: string;
  readonly event: ChannelEvent;
  readonly raw: unknown;
  readonly lookupProfile?: () => Promise<ProviderActor | undefined>;
}

/**
 * Who is speaking this turn, as the agent receives it.
 *
 * Forwarded to the agent as `forwardedProps.channelActor` on every run of a
 * turn — see {@link channelActorIdentity} for why it travels there and not on
 * the user message.
 *
 * `id` is provider-scoped, not global: two platforms can hand out the same
 * string for different people. An agent keying anything per person — a
 * third-party account, a per-user credential, a rate limit — keys it on
 * `platform` and `id` together, never `id` alone.
 *
 * `kind` and the display fields are provider-reported metadata. They are useful
 * for addressing someone and useless for deciding what they may do.
 */
export interface ChannelActorIdentity {
  readonly id: string;
  readonly kind: ProviderActor["kind"];
  /** Source provider for this turn, e.g. `"slack"`. Namespaces `id`. */
  readonly platform: string;
  readonly name?: string;
  readonly handle?: string;
  readonly email?: string;
}

/**
 * The trusted actor for one turn, or `undefined` when the ingress named nobody.
 *
 * This exists because the obvious alternative is wrong. AG-UI messages carry an
 * optional author, and putting the actor there would be a smaller change — but
 * that field is part of the message list handed to a model provider, and
 * providers validate it. OpenAI accepts only `[A-Za-z0-9_-]` in a message
 * author; Teams actor ids contain a colon, and adapters bound an actor id at 512
 * characters and nothing else. So an id that happens to fit one provider today
 * is not a contract, and sanitizing it to fit is worse than failing: a mangled
 * id still looks like an identity and silently answers as the wrong person.
 *
 * `forwardedProps` is per-run data that never enters the conversation, so no
 * provider inspects it and the value stays exactly what the adapter reported.
 *
 * An actor with no id is dropped rather than forwarded as an empty string:
 * ingress reports `id: ""` when the provider named nobody, and an agent must be
 * able to tell "nobody" from "somebody" without string-comparing a sentinel.
 */
export function channelActorIdentity(
  actor: ProviderActor | undefined,
  platform: string,
): ChannelActorIdentity | undefined {
  if (!actor?.id) return undefined;
  return {
    id: actor.id,
    kind: actor.kind,
    platform,
    ...(actor.name ? { name: actor.name } : {}),
    ...(actor.handle ? { handle: actor.handle } : {}),
    ...(actor.email ? { email: actor.email } : {}),
  };
}

/** Explicit Channel identity strategy. */
export type ChannelIdentifyUser =
  | "platform"
  | ((
      context: ChannelIdentityContext,
    ) => ApplicationUser | null | Promise<ApplicationUser | null>);

/** Identity facts supplied by an adapter alongside every ingress event. */
export type IngressIdentityContext = Omit<
  ChannelIdentityContext,
  "provider" | "actor"
>;

/** Stable public failure for malformed custom identity results. */
export class ChannelIdentityResultError extends Error {
  readonly code = "channel_identity_invalid";

  constructor() {
    super(
      "Channel identifyUser must return null or an application user with non-empty id and name",
    );
    this.name = "ChannelIdentityResultError";
  }
}

/** Stable public failure for a configured identity callback exception. */
export class ChannelIdentityResolutionError extends Error {
  readonly code = "channel_identity_failed";
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super("Channel identifyUser failed");
    this.name = "ChannelIdentityResolutionError";
    this.cause = cause;
  }
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateApplicationUser(value: unknown): ApplicationUser | null {
  if (value === null) return null;
  if (
    typeof value !== "object" ||
    value === undefined ||
    !hasText((value as { id?: unknown }).id) ||
    !hasText((value as { name?: unknown }).name)
  ) {
    throw new ChannelIdentityResultError();
  }
  return Object.freeze({
    id: (value as { id: string }).id,
    name: (value as { name: string }).name,
  });
}

/** Resolve one immutable canonical application user for one ingress event. */
export async function resolveChannelUser(
  identifyUser: ChannelIdentifyUser | undefined,
  context: ChannelIdentityContext,
): Promise<ApplicationUser | null> {
  if (identifyUser === undefined) return null;
  if (identifyUser === "platform") {
    if (context.actor.kind !== "human") return null;
    return Object.freeze({
      id: [context.provider, context.tenant.id, context.actor.id].join(":"),
      name: context.actor.name ?? context.actor.handle ?? context.actor.id,
    });
  }
  let identified: ApplicationUser | null;
  try {
    identified = await identifyUser(context);
  } catch (cause) {
    throw new ChannelIdentityResolutionError(cause);
  }
  return validateApplicationUser(identified);
}
