"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { useAgent } from "@copilotkit/react-core/v2";

const openBoxAgentId = "default";
const openBoxTimingStateKey = "openboxTimingEvent";

export type OpenBoxLiveTiming = {
  action: string;
  request: string;
  startedAtMs: number;
  steps: OpenBoxLiveTimingStep[];
};

type OpenBoxTimingEvent = {
  phase: "started" | "finished";
  key: string;
  label: string;
  kind: string;
  startedAt?: string;
  completedAt?: string;
  ms?: number;
};

type OpenBoxTimingPayload = {
  schemaVersion: "openbox.copilotkit.timing.v1";
  action: string;
  request: string;
  event: OpenBoxTimingEvent;
};

type OpenBoxLiveTimingStep = {
  key: string;
  label: string;
  kind: string;
  startedAtMs: number;
  ms?: number;
};

type OpenBoxRendererProps = {
  parameters?: Record<string, unknown>;
  result?: unknown;
  [key: string]: unknown;
};

let liveTimingSnapshot: OpenBoxLiveTiming | null = null;
const liveTimingSubscribers = new Set<() => void>();

export function OpenBoxLiveTimingProvider({
  children,
}: {
  children: ReactNode;
}) {
  useOpenBoxLiveTimingSubscription();
  return <>{children}</>;
}

export function useOpenBoxLiveTimingValue(): OpenBoxLiveTiming | null {
  return useSyncExternalStore(
    subscribeToLiveTiming,
    getLiveTimingSnapshot,
    getLiveTimingSnapshot,
  );
}

export function withOpenBoxLiveTimingProps<T extends OpenBoxRendererProps>(
  props: T,
  liveTiming: OpenBoxLiveTiming | null,
): T {
  if (!liveTiming) return props;
  const parameters = recordValue(props.parameters);
  const action = stringValue(parameters.action);
  const request = stringValue(parameters.request);
  if (action && action !== liveTiming.action) return props;
  if (request && request !== liveTiming.request) return props;
  return {
    ...props,
    parameters: {
      ...parameters,
      action: action || liveTiming.action,
      request: request || liveTiming.request,
      timings: timingsFromLiveTiming(liveTiming),
    },
  };
}

export function timingsFromLiveTiming(liveTiming: OpenBoxLiveTiming) {
  const now = Date.now();
  const steps = liveTiming.steps.map((step) => ({
    key: step.key,
    label: step.label,
    kind: step.kind,
    ms:
      typeof step.ms === "number"
        ? step.ms
        : Math.max(0, now - step.startedAtMs),
  }));
  return {
    totalMs: steps.reduce((sum, step) => sum + step.ms, 0),
    steps,
  };
}

function useOpenBoxLiveTimingSubscription() {
  const { agent } = useAgent({ agentId: openBoxAgentId });
  const liveTiming = useOpenBoxLiveTimingValue();
  const hasActiveStep =
    liveTiming?.steps.some((step) => typeof step.ms !== "number") ?? false;
  const [, forceTick] = useState(0);

  useEffect(() => {
    const subscription = agent.subscribe({
      onRunStartedEvent: () => setLiveTimingSnapshot(null),
      onRunFinishedEvent: () => setLiveTimingSnapshot(null),
      onRunFinalized: () => setLiveTimingSnapshot(null),
      onRunFailed: () => setLiveTimingSnapshot(null),
      onRunErrorEvent: () => setLiveTimingSnapshot(null),
      onStateChanged: ({ state }) => {
        const payload = timingPayloadFromAgentState(state);
        if (!payload) return;
        updateLiveTimingSnapshot((current) =>
          applyTimingPayload(current, payload),
        );
      },
    });

    return () => subscription.unsubscribe();
  }, [agent]);

  useEffect(() => {
    const payload = timingPayloadFromAgentState(agent.state);
    if (!payload) return;
    updateLiveTimingSnapshot((current) => applyTimingPayload(current, payload));
  }, [agent.state]);

  useEffect(() => {
    if (!hasActiveStep) return;
    const interval = window.setInterval(() => {
      forceTick((tick) => tick + 1);
      updateLiveTimingSnapshot((current) =>
        current ? { ...current, steps: [...current.steps] } : current,
      );
    }, 250);
    return () => window.clearInterval(interval);
  }, [hasActiveStep]);
}

function getLiveTimingSnapshot() {
  return liveTimingSnapshot;
}

function subscribeToLiveTiming(listener: () => void) {
  liveTimingSubscribers.add(listener);
  return () => {
    liveTimingSubscribers.delete(listener);
  };
}

function setLiveTimingSnapshot(next: OpenBoxLiveTiming | null) {
  liveTimingSnapshot = next;
  notifyLiveTimingSubscribers();
}

function updateLiveTimingSnapshot(
  updater: (current: OpenBoxLiveTiming | null) => OpenBoxLiveTiming | null,
) {
  liveTimingSnapshot = updater(liveTimingSnapshot);
  notifyLiveTimingSubscribers();
}

function notifyLiveTimingSubscribers() {
  liveTimingSubscribers.forEach((listener) => listener());
}

function timingPayloadFromAgentState(
  state: unknown,
): OpenBoxTimingPayload | null {
  const record = recordValue(state);
  return timingPayloadFromTimingValue(
    recordValue(record[openBoxTimingStateKey]),
  );
}

function timingPayloadFromTimingValue(
  value: Record<string, unknown>,
): OpenBoxTimingPayload | null {
  if (value.schemaVersion !== "openbox.copilotkit.timing.v1") return null;
  const action = stringValue(value.action);
  const request = stringValue(value.request);
  const timingEvent = recordValue(value.event);
  const phase = stringValue(timingEvent.phase);
  const key = stringValue(timingEvent.key);
  const label = stringValue(timingEvent.label);
  const kind = stringValue(timingEvent.kind);
  if (!action || !request || !key || !label) return null;
  if (phase !== "started" && phase !== "finished") return null;
  return {
    schemaVersion: "openbox.copilotkit.timing.v1",
    action,
    request,
    event: {
      phase,
      key,
      label,
      kind: kind || "tool",
      startedAt: stringValue(timingEvent.startedAt) || undefined,
      completedAt: stringValue(timingEvent.completedAt) || undefined,
      ms:
        typeof timingEvent.ms === "number" && Number.isFinite(timingEvent.ms)
          ? timingEvent.ms
          : undefined,
    },
  };
}

function applyTimingPayload(
  current: OpenBoxLiveTiming | null,
  payload: OpenBoxTimingPayload,
): OpenBoxLiveTiming {
  const now = Date.now();
  const base =
    current &&
    current.action === payload.action &&
    current.request === payload.request
      ? current
      : {
          action: payload.action,
          request: payload.request,
          startedAtMs: now,
          steps: [],
        };
  const existingIndex = base.steps.findIndex(
    (step) => step.key === payload.event.key,
  );
  const existingStep =
    existingIndex >= 0 ? base.steps[existingIndex] : undefined;
  const nextStep: OpenBoxLiveTimingStep = {
    key: payload.event.key,
    label: payload.event.label,
    kind: payload.event.kind,
    startedAtMs: existingStep?.startedAtMs ?? now,
    ms:
      payload.event.phase === "finished"
        ? Math.max(
            0,
            payload.event.ms ?? now - (existingStep?.startedAtMs ?? now),
          )
        : undefined,
  };
  const steps =
    existingIndex >= 0
      ? base.steps.map((step, index) =>
          index === existingIndex ? nextStep : step,
        )
      : [...base.steps, nextStep];
  return {
    ...base,
    steps,
  };
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
