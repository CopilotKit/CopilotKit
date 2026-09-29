import { subscribeToRequests } from "./network";
import { contextScope, describeContext } from "./context";
import {
  hasSensitiveFieldHint,
  readControlText,
  sensitiveContent,
} from "./text";
import { subscribeToNavigation } from "./navigation";
import { createObjectReferences } from "./references";
import { describePage } from "./page";
import { sanitizeRequestBody, sanitizeResponseBody } from "./request-data";
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
  ProductInteractionText,
  ProductControlState,
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
 * Capture trusted user actions, related requests and bounded screen context. No events are sent
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
  const captureText = captureNames && options.captureTextValues !== false;
  const captureResponses =
    captureText && options.captureResponseBodies !== false;
  const references = createObjectReferences();
  const captureId = id();
  const observeContext = (element: Element, scope?: Element) =>
    describeContext(element, scope, {
      captureTextValues: captureText,
      editing: edited,
    });
  type Previous = {
    text?: ProductInteractionText;
    state?: ProductControlState;
  };
  let priorValues = new WeakMap<Element, Previous>();
  let edited = new WeakSet<Element>();
  let dragSource: ProductInteractionTarget | undefined;
  let screenTimer: ReturnType<typeof setTimeout> | undefined;
  let screenWindowStart = Date.now();
  let screenCount = 0;
  let lastNavigation = win.location.href;
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
    const controls = doc.querySelectorAll(
      "input,textarea,select,[contenteditable]",
    );
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
        hasSensitiveFieldHint(control)
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
    event = { ...event, captureId };
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
      ? changedContext(observeContext(current.element))
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

  type Interaction = Extract<ProductInteractionEvent, { type: "interaction" }>;
  function onAction(
    event: Event,
    kind?: Interaction["action"],
    extra: Partial<Pick<Interaction, "text" | "shortcut" | "dragSource">> = {},
    observedElement?: Element,
  ) {
    // No test/developer switch can relax this: synthetic agent events are not
    // user interventions, and must not become training evidence.
    if (!event.isTrusted || notifying || stopped) return;
    activity++;
    const element =
      observedElement ??
      event
        .composedPath()
        .find((node): node is Element => node instanceof Element);
    if (!element || !visibleElement(element)) {
      action = undefined;
      return;
    }
    const target =
      element.closest(
        "button,a,input,select,textarea,[contenteditable]:not([contenteditable=false]),form,[role]",
      ) ?? element;
    if (!visibleElement(target)) return;
    const actionKind = kind ?? (event.type as Interaction["action"]);
    if (actionKind === "change") edited.delete(target);
    const current: Action = {
      id: id(),
      requests: 0,
      changes: { added: 0, removed: 0, attributes: 0 },
      element: target,
      target: describeTarget(target, captureNames),
      ...(captureContext && {
        context: changedContext(observeContext(target)),
      }),
      scope: contextScope(target),
      activity,
      startedAt: Date.now(),
      ...((captureBodies || captureResponses) && {
        privateKeys: privateBodyKeys(),
      }),
    };
    action = current;
    const previous =
      actionKind === "change" ? priorValues.get(target) : undefined;
    const text =
      actionKind === "change" &&
      captureNames &&
      options.captureTextValues !== false
        ? readControlText(target)
        : undefined;
    if (
      !emit({
        id: current.id,
        actionId: current.id,
        timestamp: Date.now(),
        type: "interaction",
        ...pageSnapshot(),
        action: actionKind,
        ...extra,
        ...(previous && { previous }),
        target: current.target,
        ...(text && { text }),
        ...(current.context && { context: current.context }),
      })
    ) {
      action = undefined;
      return;
    }
    if (actionKind === "change") {
      priorValues.delete(target);
      edited.delete(target);
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

  const nativeAction = (event: Event) => onAction(event);
  for (const name of ["click", "change", "submit"])
    doc.addEventListener(name, nativeAction, true);

  function rememberValue(event: Event) {
    if (
      !event.isTrusted ||
      stopped ||
      notifying ||
      !(event.target instanceof Element)
    )
      return;
    const target = event.target.closest(
      "input,textarea,select,[contenteditable]:not([contenteditable=false])",
    );
    if (!target || !visibleElement(target) || priorValues.has(target)) return;
    const text = captureText ? readControlText(target) : undefined;
    const state = describeTarget(target, captureNames).state;
    if (text || state)
      priorValues.set(target, {
        ...(text && { text }),
        ...(state && { state }),
      });
  }
  function commitEditable(event: Event) {
    if (!(event.target instanceof Element)) return;
    const target = event.target;
    if (
      target.matches("[contenteditable]:not([contenteditable=false])") &&
      edited.has(target)
    )
      onAction(event, "change");
    priorValues.delete(target);
    edited.delete(target);
  }
  function onKey(event: KeyboardEvent) {
    if (!event.isTrusted || event.repeat) return;
    const key = event.key.toLowerCase();
    const command =
      (event.ctrlKey || event.metaKey) &&
      ["enter", "s", "z", "y"].includes(key);
    const navigation =
      event.altKey && ["arrowleft", "arrowright"].includes(key);
    if (!command && !navigation && key !== "escape") return;
    const shortcut = [
      event.ctrlKey && "Control",
      event.metaKey && "Meta",
      event.altKey && "Alt",
      event.shiftKey && "Shift",
      key,
    ]
      .filter(Boolean)
      .join("+");
    onAction(event, "shortcut", { shortcut });
  }
  function onDrag(event: DragEvent) {
    if (event.type === "dragstart") {
      dragSource = undefined;
      if (
        event.isTrusted &&
        event.target instanceof Element &&
        visibleElement(event.target)
      )
        dragSource = describeTarget(event.target, captureNames);
      if (dragSource) onAction(event, "dragstart");
    } else if (event.type === "drop") {
      onAction(event, "drop", { ...(dragSource && { dragSource }) });
      dragSource = undefined;
    } else dragSource = undefined;
  }
  function onSelection(event: Event) {
    if (!event.isTrusted || !captureText || notifying || stopped) return;
    const selection = win.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount !== 1)
      return;
    const range = selection.getRangeAt(0);
    const node = range.startContainer;
    const element = node.parentElement;
    // Restrict text selection to one public text node. Cross-field selections
    // and editable text have independent privacy/commit semantics.
    if (
      node !== range.endContainer ||
      node.nodeType !== Node.TEXT_NODE ||
      !element ||
      !visibleElement(element) ||
      !(event.target instanceof Node) ||
      !element.contains(event.target) ||
      element.closest(
        "input,textarea,[contenteditable]:not([contenteditable=false]),[data-copilotkit]",
      )
    )
      return;
    const length = range.endOffset - range.startOffset;
    let text: ProductInteractionText;
    if (length > 1024 || (node as Text).length > 2048)
      text = { omitted: "size-limit" };
    else {
      const source = (node as Text).data;
      const value = source.slice(range.startOffset, range.endOffset);
      text = sensitiveContent(source)
        ? { omitted: "sensitive-content" }
        : new TextEncoder().encode(value).byteLength > 2048
          ? { omitted: "size-limit" }
          : sensitiveContent(value)
            ? { omitted: "sensitive-content" }
            : { value };
    }
    onAction(event, "selection", { text }, element);
  }
  doc.addEventListener("focusin", rememberValue, true);
  doc.addEventListener("pointerdown", rememberValue, true);
  doc.addEventListener("focusout", commitEditable, true);
  doc.addEventListener("keydown", onKey, true);
  for (const name of ["dragstart", "drop", "dragend"])
    doc.addEventListener(name, onDrag as EventListener, true);
  const scheduleSelection = (event: Event) => {
    if (!event.isTrusted || !captureText) return;
    const timer = setTimeout(() => {
      timers.delete(timer);
      onSelection(event);
    }, 0);
    timers.add(timer);
  };
  doc.addEventListener("pointerup", scheduleSelection, true);
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
    if (event.target instanceof Element) edited.add(event.target);
  }
  doc.addEventListener("input", onInput, true);

  function scheduleScreen(trigger: "initial" | "navigation" | "screen-change") {
    if (!captureContext || stopped || notifying) return;
    if (screenTimer !== undefined) {
      if (trigger === "screen-change") return;
      clearTimeout(screenTimer);
      timers.delete(screenTimer);
    }
    const timer = setTimeout(
      () => {
        timers.delete(timer);
        screenTimer = undefined;
        if (stopped || !doc.body) return;
        if (Date.now() - screenWindowStart >= 60_000) {
          screenWindowStart = Date.now();
          screenCount = 0;
        }
        // Standalone observations do not fabricate a user action or causality.
        // A changing dashboard cannot consume the whole action-event budget.
        if (trigger === "screen-change" && screenCount >= 10) return;
        const active = doc.activeElement;
        const target =
          active instanceof Element &&
          active !== doc.body &&
          visibleElement(active)
            ? active
            : (doc.querySelector("main,[role=main],dialog[open]") ?? doc.body);
        const context =
          trigger === "navigation"
            ? (observeContext(target) ?? { items: [] })
            : changedContext(observeContext(target));
        if (
          context &&
          emit({
            id: id(),
            timestamp: Date.now(),
            type: "context",
            trigger,
            ...pageSnapshot(),
            context,
          })
        )
          screenCount++;
      },
      trigger === "screen-change" ? 300 : 0,
    );
    screenTimer = timer;
    timers.add(timer);
  }
  const stopNavigation = captureContext
    ? subscribeToNavigation(win, () => {
        if (win.location.href === lastNavigation) return;
        lastNavigation = win.location.href;
        if (!action) activity++;
        scheduleScreen("navigation");
      })
    : () => {};
  scheduleScreen("initial");

  const observer =
    (options.captureDomChanges !== false || captureContext) &&
    typeof MutationObserver !== "undefined"
      ? new MutationObserver((records) => {
          if (stopped || notifying) return;
          if (
            records.slice(0, 100).some((record) => {
              const element =
                record.target instanceof Element
                  ? record.target
                  : record.target.parentElement;
              return (
                element &&
                visibleElement(element) &&
                !element.closest(
                  "input,textarea,[contenteditable]:not([contenteditable=false]),[data-copilotkit]",
                )
              );
            })
          )
            scheduleScreen("screen-change");
          if (!action || options.captureDomChanges === false) return;
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
              ? sanitizeRequestBody(
                  rawBody,
                  current.privateKeys,
                  references.reference,
                )
              : { omittedFieldCount: 1, omissionReason: "truncated" };
          }
          const method = /^[a-z]{1,20}$/i.test(rawMethod)
            ? rawMethod.toUpperCase()
            : "OTHER";
          let requestEmitted = false;
          const objectReferences = references.forUrl(
            rawUrl,
            win.location.href,
            url,
          );
          return {
            ...(captureResponses && {
              response: (rawResponse: unknown, format: "json" | "text") => {
                if (!requestEmitted) return;
                const liveKeys = privateBodyKeys();
                const keys =
                  current.privateKeys && liveKeys
                    ? [...new Set([...current.privateKeys, ...liveKeys])]
                    : undefined;
                const responseBody = keys
                  ? sanitizeResponseBody(
                      rawResponse,
                      format,
                      keys,
                      references.reference,
                    )
                  : {
                      omittedFieldCount: 1,
                      omissionReason: "truncated" as const,
                    };
                emit({
                  id: id(),
                  actionId: current.id,
                  timestamp: Date.now(),
                  type: "response",
                  requestId,
                  ...requestPage,
                  response: {
                    method,
                    url,
                    body: responseBody,
                    ...(objectReferences?.length && {
                      references: objectReferences,
                    }),
                  },
                });
              },
            }),
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
                  ...(objectReferences?.length && {
                    references: objectReferences,
                  }),
                  durationMs: Math.max(0, Date.now() - started),
                  ...completion,
                },
              });
              requestEmitted = emitted;
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
                  observeContext(current.element, current.scope),
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
      doc.removeEventListener(name, nativeAction, true);
    doc.removeEventListener("input", onInput, true);
    doc.removeEventListener("focusin", rememberValue, true);
    doc.removeEventListener("pointerdown", rememberValue, true);
    doc.removeEventListener("focusout", commitEditable, true);
    doc.removeEventListener("keydown", onKey, true);
    for (const name of ["dragstart", "drop", "dragend"])
      doc.removeEventListener(name, onDrag as EventListener, true);
    doc.removeEventListener("pointerup", scheduleSelection, true);
    priorValues = new WeakMap();
    edited = new WeakSet();
    dragSource = undefined;
    references.clear();
    stopNavigation();
    observer?.disconnect();
    unsubscribe();
  };
}
