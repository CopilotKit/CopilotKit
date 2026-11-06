import type { CopilotRuntimeLike } from "../../core/runtime";
import type { AgentRunner } from "../../runner/agent-runner";
import {
  enforcesThreadOwnership,
  supportsLocalThreadEndpoints,
} from "../../runner/agent-runner";
import { errorResponse } from "./json-response";
import {
  hasIdentifyUser,
  resolveIntelligenceUser,
} from "./resolve-intelligence-user";

/**
 * How local (non-Intelligence) Threads are shared among callers that
 * `identifyUser` does not identify. The full policy is
 * {@link ANONYMOUS_THREAD_ACCESS}.
 *
 * - `"owner"` (default): a Thread created without identity is a capability.
 *   Whoever holds its id may read, connect to, continue and stop it, but
 *   nobody may list or bulk-clear such Threads.
 * - `"open"`: every caller without identity shares those Threads, list and
 *   clear included, as in earlier releases. Insecure for any deployment that
 *   more than one person can reach.
 *
 * Neither mode loosens identity: with `identifyUser`, every operation reaches
 * only the caller's own Threads, and a Thread that an identified user created
 * is never reachable by an anonymous caller or another identity.
 */
export type ThreadAccessMode = "owner" | "open";

export interface ThreadsConfig {
  /** @default "owner" */
  access?: ThreadAccessMode;
}

/** The one place that sets the default Thread access mode. */
export const DEFAULT_THREAD_ACCESS: ThreadAccessMode = "owner";

/** Owner id of a Thread created without identity. */
export const ANONYMOUS_THREAD_OWNER = "";

/**
 * Every operation on a local Thread. `read` covers
 * `/threads/:id/{messages,events,state}`; `stop` covers a stop by Thread and a
 * stop by run id. `isRunning` has no route; runners check it the same way.
 */
export type ThreadOperation =
  | "list"
  | "clear"
  | "read"
  | "connect"
  | "run"
  | "stop"
  | "isRunning";

/**
 * THE anonymous-Thread policy: which operations a caller without identity
 * (no `identifyUser`) may perform, per access mode. Every such operation
 * still reaches only anonymous Threads, never a Thread an identified user
 * owns. To tighten the default, change the `owner` row; nothing else encodes
 * this policy.
 *
 * Callers identified by `identifyUser` are not in this table: every operation
 * is allowed and reaches only their own Threads.
 */
export const ANONYMOUS_THREAD_ACCESS: Readonly<
  Record<ThreadAccessMode, Readonly<Record<ThreadOperation, boolean>>>
> = {
  // A Thread id works as a capability for the Thread it names. Enumerating or
  // wiping every anonymous Thread needs identity or an explicit opt-in.
  owner: {
    list: false,
    clear: false,
    read: true,
    connect: true,
    run: true,
    stop: true,
    isRunning: true,
  },
  open: {
    list: true,
    clear: true,
    read: true,
    connect: true,
    run: true,
    stop: true,
    isRunning: true,
  },
};

export const THREAD_ACCESS_NOT_CONFIGURED_MESSAGE =
  "Listing and clearing threads need a caller identity. Pass `identifyUser: (request) => ({ id, name })` " +
  "to CopilotRuntime so each user lists and clears only their own threads, or pass " +
  '`threads: { access: "open" }` to let every caller share threads created without identity ' +
  "(insecure for multi-user deployments).";

/**
 * The configuration error for `identifyUser` with a runner that cannot keep
 * users apart. Every Thread operation is refused rather than served unscoped.
 */
export function threadOwnershipUnsupportedMessage(runner: AgentRunner): string {
  const name = runner.constructor?.name || "the configured runner";
  return (
    `identifyUser is set, but the runner ${name} does not enforce thread ownership: ` +
    "it has no isThreadAccessible method. Thread routes, run, connect and stop are refused " +
    "so that no user can reach another user's threads. Use InMemoryAgentRunner or " +
    "SqliteAgentRunner, or implement isThreadAccessible and honor ownerId in run, connect, " +
    "stop and isRunning."
  );
}

/**
 * Log once, at runtime construction, when `identifyUser` is set but the runner
 * does not enforce thread ownership. Requests then fail with the same message.
 */
export function warnIfThreadOwnershipUnenforced(
  runtime: CopilotRuntimeLike,
): void {
  if (hasIdentifyUser(runtime) && !enforcesThreadOwnership(runtime.runner)) {
    console.warn(
      `[CopilotKit] ${threadOwnershipUnsupportedMessage(runtime.runner)}`,
    );
  }
}

/**
 * The access mode `threads` selects. Throws on anything but an object whose
 * `access` is `"owner"`, `"open"` or omitted: a typo must not silently fall
 * back to the default.
 */
export function resolveThreadAccessMode(
  config: ThreadsConfig | undefined,
): ThreadAccessMode {
  if (config === undefined) return DEFAULT_THREAD_ACCESS;
  if (typeof config !== "object" || config === null) {
    throw new Error(
      '`threads` must be an object, such as `{ access: "owner" }`; got ' +
        JSON.stringify(config),
    );
  }
  const access: unknown = config.access;
  if (access === undefined) return DEFAULT_THREAD_ACCESS;
  if (access !== "owner" && access !== "open") {
    throw new Error(
      `threads.access must be "owner" or "open"; got ${JSON.stringify(access)}`,
    );
  }
  return access;
}

let threadListRefusalWarned = false;

/** Re-arm the once-per-process startup warnings. Internal: for tests. */
export function ɵresetThreadAccessWarnings(): void {
  threadListRefusalWarned = false;
}

/**
 * Log once per process, at runtime construction, when the configuration
 * refuses the Thread list and clear routes, so operators see why those
 * requests get 403.
 */
export function warnIfThreadListRefused(runtime: CopilotRuntimeLike): void {
  if (threadListRefusalWarned) return;
  if (!supportsLocalThreadEndpoints(runtime.runner)) return;
  if (isThreadOperationAvailable(runtime, "list")) return;
  threadListRefusalWarned = true;
  console.warn(
    `[CopilotKit] ${THREAD_ACCESS_NOT_CONFIGURED_MESSAGE} Until then, ` +
      "GET /threads and POST /threads/clear return HTTP 403.",
  );
}

/**
 * True when `operation` can serve requests on this runtime at all: always
 * with `identifyUser` (scoped to the caller), otherwise per
 * {@link ANONYMOUS_THREAD_ACCESS}.
 */
export function isThreadOperationAvailable(
  runtime: CopilotRuntimeLike,
  operation: ThreadOperation,
): boolean {
  // The same identity test as resolveLocalThreadOwner, so a non-function
  // value is no identity everywhere and never opens list or clear.
  if (hasIdentifyUser(runtime)) {
    return enforcesThreadOwnership(runtime.runner);
  }
  return ANONYMOUS_THREAD_ACCESS[runtime.threadAccess ?? DEFAULT_THREAD_ACCESS][
    operation
  ];
}

/**
 * Resolves the owner id that a local Thread request acts as, or the error
 * Response that refuses it. Every local Thread handler goes through here.
 *
 * - With `identifyUser`: the identified user's id. Refused when the runner
 *   cannot enforce owners, or when identification fails.
 * - Without it: the anonymous owner, when {@link ANONYMOUS_THREAD_ACCESS}
 *   allows `operation` in the configured mode; otherwise a 403 that names the
 *   options to set.
 */
export async function resolveLocalThreadOwner(params: {
  runtime: CopilotRuntimeLike;
  request: Request;
  operation: ThreadOperation;
}): Promise<string | Response> {
  const { runtime, request, operation } = params;
  if (hasIdentifyUser(runtime)) {
    // Never serve an identified request through a runner that cannot keep
    // users apart: refuse it with the configuration error instead.
    if (!enforcesThreadOwnership(runtime.runner)) {
      return Response.json(
        {
          error: "thread_ownership_unsupported",
          message: threadOwnershipUnsupportedMessage(runtime.runner),
        },
        { status: 500 },
      );
    }
    const user = await resolveIntelligenceUser({ runtime, request });
    return user instanceof Response ? user : user.id;
  }
  if (!isThreadOperationAvailable(runtime, operation)) {
    return Response.json(
      {
        error: "thread_access_not_configured",
        message: THREAD_ACCESS_NOT_CONFIGURED_MESSAGE,
      },
      { status: 403 },
    );
  }
  return ANONYMOUS_THREAD_OWNER;
}

/**
 * The response to a run on a Thread that another identity owns, whether the
 * handler's check or the runner refused it. It is the same 404 and body as an
 * unknown Thread on the inspect routes, so it does not say that the Thread
 * belongs to someone. A run on an unknown Thread id creates the Thread, so a
 * refusal still shows that the id is taken; it never shows by whom.
 */
export function threadAccessDeniedResponse(): Response {
  return errorResponse("Thread not found", 404);
}
