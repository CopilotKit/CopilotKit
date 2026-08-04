import type { ApplicationUser } from "@copilotkit/channels-ui";

/** Access granted to one Intelligence Memory scope for one agent run. */
export type MemoryAccess = "none" | "read" | "read-write";

/** Explicit user and project Memory access for one agent run. */
export interface MemoryGrant {
  readonly user?: MemoryAccess;
  readonly project?: MemoryAccess;
}

/** Fully resolved, immutable Memory context passed to managed execution. */
export interface ResolvedChannelMemory {
  readonly grant: Required<MemoryGrant>;
  readonly user: ApplicationUser | null;
}

/** A JavaScript caller bypassed the typed Channel Memory grant contract. */
export class ChannelMemoryGrantInvalidError extends Error {
  readonly code = "channel_memory_grant_invalid";

  constructor() {
    super('Channel Memory access must be "none", "read", or "read-write"');
    this.name = "ChannelMemoryGrantInvalidError";
  }
}

const MEMORY_ACCESS = new Set<unknown>(["none", "read", "read-write"]);

/** Fill omitted scopes with no access. */
export function resolveMemoryGrant(grant: MemoryGrant): Required<MemoryGrant> {
  const resolved = Object.freeze({
    user: grant.user ?? "none",
    project: grant.project ?? "none",
  });
  if (
    !MEMORY_ACCESS.has(resolved.user) ||
    !MEMORY_ACCESS.has(resolved.project)
  ) {
    throw new ChannelMemoryGrantInvalidError();
  }
  return resolved;
}

/** True when a grant requests any Intelligence Memory operation. */
export function hasMemoryAccess(grant: Required<MemoryGrant>): boolean {
  return grant.user !== "none" || grant.project !== "none";
}
