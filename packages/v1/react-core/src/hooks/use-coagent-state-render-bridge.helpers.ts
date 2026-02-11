import { dataToUUID, parseJson } from "@copilotkit/shared";

export enum RenderStatus {
  InProgress = "inProgress",
  Complete = "complete",
}

export enum ClaimAction {
  Create = "create",
  Override = "override",
  Existing = "existing",
  Block = "block",
}

export interface StateRenderContext {
  agentId: string;
  stateRenderId: string;
  messageId: string;
  runId: string;
  messageIndex?: number;
}

export interface Claim {
  stateRenderId: string;
  runId?: string;
  stateSnapshot?: any;
  locked?: boolean;
  messageIndex?: number;
}

export type ClaimsByMessageId = Record<string, Claim>;

export interface ClaimResolution {
  canRender: boolean;
  action: ClaimAction;
  nextClaim?: Claim;
  lockOthers?: boolean;
  updateRunId?: string;
}

export interface SnapshotCaches {
  byStateRenderAndRun: Record<string, any>;
  byMessageId: Record<string, any>;
}

export interface SnapshotSelectionInput {
  messageId: string;
  messageName?: string;
  allowLiveState?: boolean;
  skipLatestCache?: boolean;
  stateRenderId?: string;
  effectiveRunId: string;
  stateSnapshotProp?: any;
  agentState?: any;
  agentMessages?: Array<{ id: string; role?: string }>;
  existingClaim?: Claim;
  caches: SnapshotCaches;
}

export interface SnapshotSelectionResult {
  snapshot?: any;
  hasSnapshotKeys: boolean;
  cachedSnapshot?: any;
  allowEmptySnapshot?: boolean;
  snapshotForClaim?: any;
}

function getStateWithoutConstantKeys(state: any) {
  if (!state) return {};
  const { messages, tools, copilotkit, ...stateWithoutConstantKeys } = state;
  return stateWithoutConstantKeys;
}

// Function that compares states, without the constant keys
export function areStatesEquals(a: any, b: any) {
  if ((a && !b) || (!a && b)) return false;
  const { messages, tools, copilotkit, ...aWithoutConstantKeys } = a;
  const {
    messages: bMessages,
    tools: bTools,
    copilotkit: bCopilotkit,
    ...bWithoutConstantKeys
  } = b;

  return JSON.stringify(aWithoutConstantKeys) === JSON.stringify(bWithoutConstantKeys);
}

export function isPlaceholderMessageId(messageId: string | undefined) {
  return !!messageId && messageId.startsWith("coagent-state-render-");
}

export function isPlaceholderMessageName(messageName: string | undefined) {
  return messageName === "coagent-state-render";
}

export function readCachedMessageEntry(entry: any): { snapshot?: any; runId?: string } {
  if (!entry || typeof entry !== "object") {
    return { snapshot: entry, runId: undefined };
  }
  const snapshot = "snapshot" in entry ? entry.snapshot : entry;
  const runId = "runId" in entry ? entry.runId : undefined;
  return { snapshot, runId };
}

export function getEffectiveRunId({
  existingClaimRunId,
  cachedMessageRunId,
  runId,
}: {
  existingClaimRunId?: string;
  cachedMessageRunId?: string;
  runId?: string;
}) {
  return existingClaimRunId || cachedMessageRunId || runId || "pending";
}

/**
 * Resolve whether a message can claim a render slot.
 * This is a pure decision function; the caller applies claim mutations.
 */
export function resolveClaim({
  claims,
  context,
  stateSnapshot,
}: {
  claims: ClaimsByMessageId;
  context: StateRenderContext;
  stateSnapshot?: any;
}): ClaimResolution {
  const { messageId, stateRenderId, runId, messageIndex } = context;
  const existing = claims[messageId];

  if (existing) {
    const canRender = existing.stateRenderId === stateRenderId;
    const shouldUpdateRunId =
      canRender && runId && (!existing.runId || existing.runId === "pending");
    return {
      canRender,
      action: canRender ? ClaimAction.Existing : ClaimAction.Block,
      updateRunId: shouldUpdateRunId ? runId : undefined,
    };
  }

  const normalizedRunId = runId ?? "pending";
  const renderClaimedByOtherMessageEntry = Object.entries(claims).find(
    ([, claim]) =>
      claim.stateRenderId === stateRenderId &&
      (claim.runId ?? "pending") === normalizedRunId &&
      dataToUUID(getStateWithoutConstantKeys(claim.stateSnapshot)) ===
        dataToUUID(getStateWithoutConstantKeys(stateSnapshot)),
  );

  const renderClaimedByOtherMessage = renderClaimedByOtherMessageEntry?.[1];
  const claimedMessageId = renderClaimedByOtherMessageEntry?.[0];

  if (renderClaimedByOtherMessage) {
    if (
      messageIndex !== undefined &&
      renderClaimedByOtherMessage.messageIndex !== undefined &&
      messageIndex > renderClaimedByOtherMessage.messageIndex
    ) {
      return {
        canRender: true,
        action: ClaimAction.Override,
        nextClaim: { stateRenderId, runId, messageIndex },
        lockOthers:
          runId === renderClaimedByOtherMessage.runId || isPlaceholderMessageId(claimedMessageId),
      };
    }

    if (runId && renderClaimedByOtherMessage.runId && runId !== renderClaimedByOtherMessage.runId) {
      return {
        canRender: true,
        action: ClaimAction.Override,
        nextClaim: { stateRenderId, runId, messageIndex },
        lockOthers: isPlaceholderMessageId(claimedMessageId),
      };
    }

    if (isPlaceholderMessageId(claimedMessageId)) {
      return {
        canRender: true,
        action: ClaimAction.Override,
        nextClaim: { stateRenderId, runId, messageIndex },
        lockOthers: true,
      };
    }

    if (
      stateSnapshot &&
      renderClaimedByOtherMessage.stateSnapshot &&
      !areStatesEquals(renderClaimedByOtherMessage.stateSnapshot, stateSnapshot)
    ) {
      return {
        canRender: true,
        action: ClaimAction.Override,
        nextClaim: { stateRenderId, runId },
      };
    }

    return { canRender: false, action: ClaimAction.Block };
  }

  if (!runId) {
    return { canRender: false, action: ClaimAction.Block };
  }

  return {
    canRender: true,
    action: ClaimAction.Create,
    nextClaim: { stateRenderId, runId, messageIndex },
  };
}

/**
 * Select the best snapshot to render for this message.
 * Priority order is:
 * 1) explicit message snapshot
 * 2) live agent state (latest assistant only)
 * 3) cached snapshot for message
 * 4) cached snapshot for stateRenderId+runId
 * 5) last cached snapshot for stateRenderId
 */
export function selectSnapshot({
  messageId,
  messageName,
  allowLiveState,
  skipLatestCache,
  stateRenderId,
  effectiveRunId,
  stateSnapshotProp,
  agentState,
  agentMessages,
  existingClaim,
  caches,
}: SnapshotSelectionInput): SnapshotSelectionResult {
  const lastAssistantId = agentMessages
    ? [...agentMessages].reverse().find((msg) => msg.role === "assistant")?.id
    : undefined;
  const latestSnapshot =
    stateRenderId !== undefined ? caches.byStateRenderAndRun[`${stateRenderId}::latest`] : undefined;
  const messageIndex = agentMessages
    ? agentMessages.findIndex((msg) => msg.id === messageId)
    : -1;
  const messageRole =
    messageIndex >= 0 && agentMessages ? agentMessages[messageIndex]?.role : undefined;
  let previousUserMessageId: string | undefined;
  if (messageIndex > 0 && agentMessages) {
    for (let i = messageIndex - 1; i >= 0; i -= 1) {
      if (agentMessages[i]?.role === "user") {
        previousUserMessageId = agentMessages[i]?.id;
        break;
      }
    }
  }
  const liveStateIsStale =
    stateSnapshotProp === undefined &&
    latestSnapshot !== undefined &&
    agentState !== undefined &&
    areStatesEquals(latestSnapshot, agentState);
  const shouldUseLiveState =
    (Boolean(allowLiveState) || !lastAssistantId || messageId === lastAssistantId) &&
    !liveStateIsStale;
  const snapshot = stateSnapshotProp
    ? parseJson(stateSnapshotProp, stateSnapshotProp)
    : shouldUseLiveState
      ? agentState
      : undefined;
  const hasSnapshotKeys = !!(snapshot && Object.keys(snapshot).length > 0);
  const allowEmptySnapshot =
    snapshot !== undefined &&
    !hasSnapshotKeys &&
    (stateSnapshotProp !== undefined || shouldUseLiveState);

  const messageCacheEntry = caches.byMessageId[messageId];
  const cachedMessageSnapshot = readCachedMessageEntry(messageCacheEntry).snapshot;
  const cacheKey =
    stateRenderId !== undefined ? `${stateRenderId}::${effectiveRunId}` : undefined;
  let cachedSnapshot = cachedMessageSnapshot ?? caches.byMessageId[messageId];
  if (cachedSnapshot === undefined && cacheKey && caches.byStateRenderAndRun[cacheKey] !== undefined) {
    cachedSnapshot = caches.byStateRenderAndRun[cacheKey];
  }
  if (
    cachedSnapshot === undefined &&
    stateRenderId &&
    previousUserMessageId &&
    caches.byStateRenderAndRun[`${stateRenderId}::pending:${previousUserMessageId}`] !==
      undefined
  ) {
    cachedSnapshot =
      caches.byStateRenderAndRun[`${stateRenderId}::pending:${previousUserMessageId}`];
  }
  if (
    cachedSnapshot === undefined &&
    !skipLatestCache &&
    stateRenderId &&
    messageRole !== "assistant" &&
    (stateSnapshotProp !== undefined ||
      (agentState && Object.keys(agentState).length > 0))
  ) {
    cachedSnapshot = caches.byStateRenderAndRun[`${stateRenderId}::latest`];
  }

  const snapshotForClaim = existingClaim?.locked
    ? existingClaim.stateSnapshot ?? cachedSnapshot
    : hasSnapshotKeys
      ? snapshot
      : existingClaim?.stateSnapshot ?? cachedSnapshot;

  return { snapshot, hasSnapshotKeys, cachedSnapshot, allowEmptySnapshot, snapshotForClaim };
}
