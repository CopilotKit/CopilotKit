import { subscribeToRequests } from "./network";
import { contextScope, describeContext } from "./context";
import { hasSensitiveFieldHint, readChangedText } from "./text";
import { describePage } from "./page";
import { sanitizeRequestBody } from "./request-data";
import {
  describeTarget,
  isSensitive,
  parsePrefixes,
  safeRequestUrl,
  visibleElement,
} from "./privacy";
import type {
  ProductInteractionCaptureOptions,
  ProductInteractionEvent,
  ProductInteractionTarget,
  ProductInteractionContext,
} from "./types";

interface Action {
  id: string;
  requests: number;
  changes: { added: number; removed: number; attributes: number };
  element: Element;
  target: ProductInteractionTarget;
  context?: ProductInteractionContext;
  scope?: Element;
  activity: number;
  startedAt: number;
  privateKeys?: string[];
}

function id(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues)
    globalThis.crypto.getRandomValues(bytes);
  else
    for (let i = 0; i < bytes.length; i++)
      bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function bounded(
  value: number | undefined,
  fallback: number,
  max: number,
): number {
  return value === undefined || !Number.isFinite(value)
    ? fallback
    : Math.max(0, Math.min(max, Math.floor(value)));
}

/**
 * Capture trusted user actions and their immediate outcomes. No events are sent
 * anywhere except onEvent. Call the returned function to remove all observers.
 * Safe to call during SSR (returns a no-op).
 */
export function startProductInteractionCapture(
  options: ProductInteractionCaptureOptions,
): () => void {
  if (
    options.enabled === false ||
    typeof window === "undefined" ||
    typeof document === "undefined"
  )
    return () => {};
  const win = window;
  const doc = document;
  const allowed = parsePrefixes(
    options.apiUrlPrefixes ?? ["/api"],
    win.location.href,
  );
  const excluded = parsePrefixes(
    options.excludedUrlPrefixes ?? [],
    win.location.href,
  );
  const maxEvents = bounded(options.maxEventsPerMinute, 120, 1000);
  const maxRequests = bounded(options.maxRequestsPerAction, 5, 20);
  const captureNames = options.captureAccessibleNames !== false;
  const captureContext = captureNames && options.captureContext !== false;
  const captureBodies =
    captureNames &&
    options.captureTextValues !== false &&
    options.captureRequestBodies !== false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let stopped = false;
  let notifying = false;
  let action: Action | undefined;
  // Request-only, microtask-scoped correlation. A response continuation is an
  // observation, not proof of async causality; it never reopens DOM capture.
  let continuation: { action: Action; requestId: string } | null | undefined;
  let continuationVersion = 0;
  let windowStart = Date.now();
  let eventCount = 0;
  let activity = 0;
  let lastContext: string | undefined;

  const requestAction = () =>
    continuation === undefined ? action : continuation?.action;
  const eligible = (current: Action | undefined): current is Action =>
    !!current &&
    !stopped &&
    !notifying &&
    current.activity === activity &&
    current.requests < maxRequests &&
    Date.now() - current.startedAt <= 30_000;

  function resumeRequest(current: Action, requestId: string) {
    if (stopped) return;
    // Keep an ineligible origin as a barrier: an old response must not be
    // mistaken for a newly selected action. Multiple origins are ambiguous.
    continuation =
      continuation === null ||
      (continuation && continuation.requestId !== requestId)
        ? null
        : { action: current, requestId };
    const version = ++continuationVersion;
    queueMicrotask(() => {
      if (version === continuationVersion) continuation = undefined;
    });
  }

  function privateBodyKeys(): string[] | undefined {
    const controls = doc.querySelectorAll("input,textarea,select");
    // Fail closed rather than leave controls outside the inspection budget.
    if (controls.length > 128) return;
    const keys: string[] = [];
    for (const control of controls) {
      if (
        !visibleElement(control) ||
        isSensitive(control) ||
        (control instanceof HTMLSelectElement &&
          Array.from(control.selectedOptions).some(
            (option) => !visibleElement(option) || isSensitive(option),
          )) ||
        ((control instanceof HTMLInputElement ||
          control instanceof HTMLTextAreaElement ||
          control instanceof HTMLSelectElement) &&
          hasSensitiveFieldHint(control))
      ) {
        for (const attribute of ["id", "name"]) {
          const key = control.getAttribute(attribute);
          if (key) keys.push(key);
        }
      }
    }
    return keys;
  }

  const pageSnapshot = () =>
    options.capturePage === false ? {} : { page: describePage(win.location) };

  function changedContext(context: ProductInteractionContext | undefined) {
    const observed = context ?? { items: [] };
    const encoded = JSON.stringify(observed);
    return encoded === (lastContext ?? '{"items":[]}') ? undefined : observed;
  }

  function emit(event: ProductInteractionEvent): boolean {
    if (stopped || notifying) return false;
    if (new TextEncoder().encode(JSON.stringify(event)).byteLength > 8192)
      return false;
    if (Date.now() - windowStart >= 60_000) {
      windowStart = Date.now();
      eventCount = 0;
    }
    if (eventCount >= maxEvents) return false;
    eventCount += 1;
    notifying = true;
    try {
      // A callback may synchronously initiate its own telemetry request or return
      // a rejecting promise. Neither may feed capture back into itself.
      const result = options.onEvent(event);
      if (result) void Promise.resolve(result).catch(() => {});
    } catch {
      /* User callbacks must not affect the application. */
    } finally {
      notifying = false;
    }
    if ("context" in event && event.context)
      lastContext = JSON.stringify(event.context);
    return true;
  }

  function flushChanges(current: Action) {
    if (options.captureDomChanges === false || activity !== current.activity)
      return;
    const target =
      current.element.isConnected && visibleElement(current.element)
        ? describeTarget(current.element, captureNames)
        : undefined;
    const context = captureContext
      ? changedContext(describeContext(current.element))
      : undefined;
    const targetChanged =
      target && JSON.stringify(target) !== JSON.stringify(current.target);
    if (
      targetChanged ||
      context ||
      Object.values(current.changes).some((count) => count > 0)
    ) {
      emit({
        id: id(),
        actionId: current.id,
        timestamp: Date.now(),
        type: "dom-change",
        ...pageSnapshot(),
        changes: { ...current.changes },
        ...(targetChanged && { target }),
        ...(context && { context }),
      });
    }
  }

  function onAction(event: Event) {
    // No test/developer switch can relax this: synthetic agent events are not
    // user interventions, and must not become training evidence.
    if (!event.isTrusted || notifying || stopped) return;
    activity++;
    const element = event
      .composedPath()
      .find((node): node is Element => node instanceof Element);
    if (!element || !visibleElement(element)) {
      action = undefined;
      return;
    }
    const target =
      element.closest("button,a,input,select,textarea,form,[role]") ?? element;
    if (!visibleElement(target)) return;
    const current: Action = {
      id: id(),
      requests: 0,
      changes: { added: 0, removed: 0, attributes: 0 },
      element: target,
      target: describeTarget(target, captureNames),
      ...(captureContext && {
        context: changedContext(describeContext(target)),
      }),
      scope: contextScope(target),
      activity,
      startedAt: Date.now(),
      ...(captureBodies && { privateKeys: privateBodyKeys() }),
    };
    action = current;
    const text =
      event.type === "change" &&
      captureNames &&
      options.captureTextValues !== false
        ? readChangedText(target)
        : undefined;
    if (
      !emit({
        id: current.id,
        actionId: current.id,
        timestamp: Date.now(),
        type: "interaction",
        ...pageSnapshot(),
        action: event.type as "click" | "change" | "submit",
        target: current.target,
        ...(text && { text }),
        ...(current.context && { context: current.context }),
      })
    ) {
      action = undefined;
      return;
    }
    // Clearing on the next task deliberately excludes polling and debounced /
    // delayed requests; a broad time window would invent causal relationships.
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (action === current) action = undefined;
      flushChanges(current);
    }, 0);
    timers.add(timer);
  }

  for (const name of ["click", "change", "submit"])
    doc.addEventListener(name, onAction, true);
  // Editing is an intervention even when its value is deliberately omitted.
  // A native checkbox/radio input accompanies its click. Other input cancels a
  // pending observation without becoming a keystroke event, even if the browser
  // has not serviced the earlier action's closing timer yet.
  function onInput(event: Event) {
    if (!event.isTrusted || stopped || notifying) return;
    const sameActivation =
      action?.element === event.target &&
      event.target instanceof HTMLInputElement &&
      ["checkbox", "radio"].includes(event.target.type);
    if (!sameActivation) activity++;
  }
  doc.addEventListener("input", onInput, true);

  const observer =
    options.captureDomChanges !== false &&
    typeof MutationObserver !== "undefined"
      ? new MutationObserver((records) => {
          if (!action || stopped || notifying) return;
          // Bounded inspection as well as bounded output for large application updates.
          for (const record of records.slice(0, 100)) {
            const target =
              record.target instanceof Element
                ? record.target
                : record.target.parentElement;
            if (!target) continue;
            if (isSensitive(target)) continue;
            if (record.type === "attributes")
              action.changes.attributes = Math.min(
                100,
                action.changes.attributes + 1,
              );
            else {
              const visibleCount = (nodes: NodeList) => {
                let count = 0;
                for (
                  let index = 0;
                  index < Math.min(nodes.length, 100);
                  index++
                ) {
                  const node = nodes[index];
                  if (node instanceof Element && !isSensitive(node)) count += 1;
                }
                return count;
              };
              action.changes.added = Math.min(
                100,
                action.changes.added + visibleCount(record.addedNodes),
              );
              action.changes.removed = Math.min(
                100,
                action.changes.removed + visibleCount(record.removedNodes),
              );
            }
          }
        })
      : undefined;
  observer?.observe(doc, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      "aria-expanded",
      "aria-checked",
      "aria-selected",
      "aria-pressed",
      "aria-disabled",
      "aria-label",
      "checked",
      "selected",
      "disabled",
      "hidden",
    ],
  });

  const unsubscribe =
    options.captureRequests !== false
      ? subscribeToRequests(win, (rawUrl, rawMethod, rawBody) => {
          const current = requestAction();
          if (!eligible(current)) return;
          const url = safeRequestUrl(
            rawUrl,
            win.location.href,
            allowed,
            excluded,
          );
          if (!url) return;
          const parentRequestId = continuation?.requestId;
          current.requests += 1;
          const requestId = id();
          const started = Date.now();
          const requestPage = pageSnapshot();
          let body: ReturnType<typeof sanitizeRequestBody> | undefined;
          if (rawBody != null && captureBodies) {
            // Keep explicit privacy markers even if a submission removes its
            // form before fetching or while an earlier response is pending.
            const liveKeys = privateBodyKeys();
            current.privateKeys =
              current.privateKeys && liveKeys
                ? [...new Set([...current.privateKeys, ...liveKeys])]
                : undefined;
            body = current.privateKeys
              ? sanitizeRequestBody(rawBody, current.privateKeys)
              : { omittedFieldCount: 1, omissionReason: "truncated" };
          }
          const method = /^[a-z]{1,20}$/i.test(rawMethod)
            ? rawMethod.toUpperCase()
            : "OTHER";
          return {
            resume: () => resumeRequest(current, requestId),
            canContinue: () => requestAction() === current && eligible(current),
            complete: (completion) => {
              const emitted = emit({
                id: requestId,
                actionId: current.id,
                timestamp: Date.now(),
                type: "request",
                ...requestPage,
                request: {
                  method,
                  url,
                  attribution: parentRequestId
                    ? "response-continuation"
                    : "user-action",
                  ...(parentRequestId && { parentRequestId }),
                  ...(body && { body }),
                  durationMs: Math.max(0, Date.now() - started),
                  ...completion,
                },
              });
              if (
                !emitted ||
                !captureContext ||
                activity !== current.activity ||
                !current.scope?.isConnected
              )
                return;
              const timer = setTimeout(() => {
                timers.delete(timer);
                if (
                  stopped ||
                  activity !== current.activity ||
                  !current.scope?.isConnected
                )
                  return;
                const context = changedContext(
                  describeContext(current.element, current.scope),
                );
                if (context)
                  emit({
                    id: id(),
                    actionId: current.id,
                    timestamp: Date.now(),
                    type: "context",
                    ...pageSnapshot(),
                    trigger: "request-completed",
                    requestId,
                    context,
                  });
              }, 50);
              timers.add(timer);
            },
          };
        })
      : () => {};

  return () => {
    stopped = true;
    action = undefined;
    continuation = undefined;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    for (const name of ["click", "change", "submit"])
      doc.removeEventListener(name, onAction, true);
    doc.removeEventListener("input", onInput, true);
    observer?.disconnect();
    unsubscribe();
  };
}
