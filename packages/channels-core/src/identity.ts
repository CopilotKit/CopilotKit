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
