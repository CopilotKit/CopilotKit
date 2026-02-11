import { useEffect } from "react";
import {
  areStatesEquals,
  ClaimAction,
  getEffectiveRunId,
  isPlaceholderMessageId,
  isPlaceholderMessageName,
  readCachedMessageEntry,
  resolveClaim,
  selectSnapshot,
  type Claim,
  type ClaimsByMessageId,
  type SnapshotCaches,
  type StateRenderContext,
} from "./use-coagent-state-render-bridge.helpers";

export interface StateRenderRegistryInput {
  agentId: string;
  stateRenderId?: string;
  message: { id: string; runId?: string; name?: string };
  messageIndex?: number;
  stateSnapshot?: any;
  agentState?: any;
  agentMessages?: Array<{ id: string; role?: string }>;
  claimsRef: React.MutableRefObject<Record<string, Claim>>;
}

export interface StateRenderRegistryResult {
  canRender: boolean;
}

const LAST_SNAPSHOTS_BY_RENDER_AND_RUN = "__lastSnapshotsByStateRenderIdAndRun";
const LAST_SNAPSHOTS_BY_MESSAGE = "__lastSnapshotsByMessageId";

type SnapshotByMessageEntry = { snapshot: any; runId?: string } | any;
type ClaimsStore = Record<string, Claim> & {
  [LAST_SNAPSHOTS_BY_RENDER_AND_RUN]?: Record<string, any>;
  [LAST_SNAPSHOTS_BY_MESSAGE]?: Record<string, SnapshotByMessageEntry>;
};

function getClaimsStore(
  claimsRef: React.MutableRefObject<Record<string, Claim>>,
): ClaimsStore {
  return claimsRef.current as ClaimsStore;
}

function getSnapshotCaches(claimsRef: React.MutableRefObject<Record<string, Claim>>): SnapshotCaches {
  const store = getClaimsStore(claimsRef);
  return {
    byStateRenderAndRun: store[LAST_SNAPSHOTS_BY_RENDER_AND_RUN] ?? {},
    byMessageId: store[LAST_SNAPSHOTS_BY_MESSAGE] ?? {},
  };
}

export function useStateRenderRegistry({
  agentId,
  stateRenderId,
  message,
  messageIndex,
  stateSnapshot,
  agentState,
  agentMessages,
  claimsRef,
}: StateRenderRegistryInput): StateRenderRegistryResult {
  const store = getClaimsStore(claimsRef);
  const runId = message.runId;
  const cachedMessageEntry = store[LAST_SNAPSHOTS_BY_MESSAGE]?.[message.id];
  const { runId: cachedMessageRunId } = readCachedMessageEntry(cachedMessageEntry);
  const existingClaimRunId = claimsRef.current[message.id]?.runId;
  const effectiveRunId = getEffectiveRunId({
    existingClaimRunId,
    cachedMessageRunId,
    runId,
  });

  useEffect(() => {
    return () => {
      const existingClaim = claimsRef.current[message.id];
      if (
        existingClaim?.stateSnapshot &&
        Object.keys(existingClaim.stateSnapshot).length > 0
      ) {
        const snapshotCache = {
          ...(store[LAST_SNAPSHOTS_BY_RENDER_AND_RUN] ?? {}),
        };
        const cacheKey = `${existingClaim.stateRenderId}::${existingClaim.runId ?? "pending"}`;
        snapshotCache[cacheKey] = existingClaim.stateSnapshot;
        snapshotCache[`${existingClaim.stateRenderId}::latest`] = existingClaim.stateSnapshot;
        store[LAST_SNAPSHOTS_BY_RENDER_AND_RUN] = snapshotCache;

        const messageCache = {
          ...(store[LAST_SNAPSHOTS_BY_MESSAGE] ?? {}),
        };
        messageCache[message.id] = {
          snapshot: existingClaim.stateSnapshot,
          runId: existingClaim.runId ?? effectiveRunId,
        };
        store[LAST_SNAPSHOTS_BY_MESSAGE] = messageCache;
      }
      delete claimsRef.current[message.id];
    };
  }, [claimsRef, effectiveRunId, message.id]);

  if (!stateRenderId) {
    return { canRender: false };
  }

  const caches = getSnapshotCaches(claimsRef);
  const existingClaim = claimsRef.current[message.id] as Claim | undefined;

  const { snapshot, hasSnapshotKeys, allowEmptySnapshot, snapshotForClaim } = selectSnapshot({
    messageId: message.id,
    messageName: message.name,
    allowLiveState:
      isPlaceholderMessageName(message.name) || isPlaceholderMessageId(message.id),
    skipLatestCache:
      isPlaceholderMessageName(message.name) || isPlaceholderMessageId(message.id),
    stateRenderId,
    effectiveRunId,
    stateSnapshotProp: stateSnapshot,
    agentState,
    agentMessages,
    existingClaim,
    caches,
  });

  const resolution = resolveClaim({
    claims: claimsRef.current as ClaimsByMessageId,
    context: {
      agentId,
      messageId: message.id,
      stateRenderId,
      runId: effectiveRunId,
      messageIndex,
    } satisfies StateRenderContext,
    stateSnapshot: snapshotForClaim,
  });

  if (resolution.action === ClaimAction.Block) {
    return { canRender: false };
  }

  if (resolution.updateRunId && claimsRef.current[message.id]) {
    claimsRef.current[message.id].runId = resolution.updateRunId;
  }

  if (resolution.nextClaim) {
    claimsRef.current[message.id] = resolution.nextClaim;
  }

  if (resolution.lockOthers) {
    Object.entries(claimsRef.current).forEach(([id, claim]) => {
      if (id !== message.id && claim.stateRenderId === stateRenderId) {
        claim.locked = true;
      }
    });
  }

  if (existingClaim && !existingClaim.locked && agentMessages?.length) {
    const indexInAgentMessages = agentMessages.findIndex((msg: any) => msg.id === message.id);
    if (indexInAgentMessages >= 0 && indexInAgentMessages < agentMessages.length - 1) {
      existingClaim.locked = true;
    }
  }

  const existingSnapshot = claimsRef.current[message.id].stateSnapshot;
  const snapshotChanged =
    stateSnapshot &&
    existingSnapshot !== undefined &&
    !areStatesEquals(existingSnapshot, snapshot);

  if (
    snapshot &&
    (stateSnapshot || hasSnapshotKeys || allowEmptySnapshot) &&
    (!claimsRef.current[message.id].locked || snapshotChanged)
  ) {
    if (!claimsRef.current[message.id].locked || snapshotChanged) {
      claimsRef.current[message.id].stateSnapshot = snapshot;
      const snapshotCache = {
        ...(store[LAST_SNAPSHOTS_BY_RENDER_AND_RUN] ?? {}),
      };
      const cacheKey = `${stateRenderId}::${effectiveRunId}`;
      snapshotCache[cacheKey] = snapshot;
      snapshotCache[`${stateRenderId}::latest`] = snapshot;
      store[LAST_SNAPSHOTS_BY_RENDER_AND_RUN] = snapshotCache;
      const messageCache = {
        ...(store[LAST_SNAPSHOTS_BY_MESSAGE] ?? {}),
      };
      messageCache[message.id] = { snapshot, runId: effectiveRunId };
      store[LAST_SNAPSHOTS_BY_MESSAGE] = messageCache;
      if (stateSnapshot) {
        claimsRef.current[message.id].locked = true;
      }
    }
  } else if (snapshotForClaim) {
    const existingSnapshot = claimsRef.current[message.id].stateSnapshot;
    if (!existingSnapshot) {
      claimsRef.current[message.id].stateSnapshot = snapshotForClaim;
      const snapshotCache = {
        ...(store[LAST_SNAPSHOTS_BY_RENDER_AND_RUN] ?? {}),
      };
      const cacheKey = `${stateRenderId}::${effectiveRunId}`;
      snapshotCache[cacheKey] = snapshotForClaim;
      snapshotCache[`${stateRenderId}::latest`] = snapshotForClaim;
      store[LAST_SNAPSHOTS_BY_RENDER_AND_RUN] = snapshotCache;
      const messageCache = {
        ...(store[LAST_SNAPSHOTS_BY_MESSAGE] ?? {}),
      };
      messageCache[message.id] = { snapshot: snapshotForClaim, runId: effectiveRunId };
      store[LAST_SNAPSHOTS_BY_MESSAGE] = messageCache;
    }
  }

  return { canRender: true };
}
