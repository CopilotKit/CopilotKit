// SERVER-SAFE: no "use client", no JSX, no .tsx imports. Reached through the
// server-only agent registry.
import type { IdentifyRunUser } from "@/shell/agent-registry";
import { DEFAULT_ADMIN_ID, SEED_ADMINS } from "../data/seed";

/**
 * Each Myelin admin gets their OWN memory bucket, keyed by admin id. That is
 * what makes the memory beats honest: Priya's saved journey conventions and
 * launch procedure are hers — Marcus, in the second window, starts clean.
 */
const ADMIN_USER_ID: Map<string, string> = new Map(
  SEED_ADMINS.map((a) => [a.id, `myelin-${a.id.replace(/^adm-/, "")}`]),
);

export const DEMO_DEFAULT_USER_ID = "myelin-demo-user";

export function resolveUserId(adminId?: string): string {
  const pinned = process.env.INTELLIGENCE_USER_ID;
  if (pinned) return pinned;
  return (adminId && ADMIN_USER_ID.get(adminId)) || DEMO_DEFAULT_USER_ID;
}

/** Every bucket a Myelin run could have written to — the reset sweeps them all. */
export function memoryScopeUserIds(): readonly string[] {
  return [
    ...new Set([
      resolveUserId(),
      ...SEED_ADMINS.map((a) => resolveUserId(a.id)),
    ]),
  ];
}

/**
 * Seed the presenter's (Priya's) bucket AND the default bucket. The default is
 * not a nicety: the runtime resolves identity on some BODYLESS requests (the
 * thread connect), where no run `properties` exist, so a run's memory tools can
 * land in `myelin-demo-user` even while Priya is signed in. Commerce seeds its
 * default for the same reason.
 */
export function memorySeedTargetUserIds(): readonly string[] {
  return [...new Set([resolveUserId(), resolveUserId(DEFAULT_ADMIN_ID)])];
}

export const myelinIdentifyUser: IdentifyRunUser = (properties) => {
  const adminId = properties?.userId;
  const admin = SEED_ADMINS.find((a) => a.id === adminId);
  return {
    id: resolveUserId(adminId),
    name: process.env.INTELLIGENCE_USER_ID
      ? (process.env.INTELLIGENCE_USER_NAME ?? process.env.INTELLIGENCE_USER_ID)
      : (admin?.name ?? "Myelin Admin"),
  };
};
