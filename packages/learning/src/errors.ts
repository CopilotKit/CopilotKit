import { cleanText, describeTarget, fieldLabel } from "./clicks";
import type { Redactor } from "./redact";
import type { Emit } from "./types";

// A render loop can throw thousands of times a second. Each distinct error is
// sent at its 1st, 10th, 100th, … occurrence, and a session sends at most 50.
const MAX_EVENTS = 50;
const MAX_KEYS = 200;
const MAX_MESSAGE = 300;
const MAX_ALERT = 200;
const MAX_STACK = 1000;
const ALERT = "[role~=alert], [aria-live=assertive]";
const RESOURCE = "img, script, link, video, audio, source, iframe";
const VALIDITY = [
  "valueMissing",
  "typeMismatch",
  "patternMismatch",
  "tooLong",
  "tooShort",
  "rangeUnderflow",
  "rangeOverflow",
  "stepMismatch",
  "badInput",
  "customError",
] as const;

type ErrorLike = { name?: unknown; message?: unknown; stack?: unknown };

/**
 * Records errors that the page or the browser reports: uncaught errors,
 * unhandled promise rejections, failed resource loads, native form validation
 * failures, and text shown in alert regions. Messages are cleaned like labels;
 * nothing here changes how the host app handles its errors.
 */
export function installErrorCapture(params: { emit: Emit; redact: Redactor }) {
  const { emit, redact } = params;
  let sent = 0;
  const counts = new Map<string, number>();
  const clean = (text: unknown, max: number) =>
    (typeof text === "string" && cleanText(text, redact, max)) || undefined;

  const report = (
    kind: string,
    key: string,
    value: Record<string, unknown>,
  ) => {
    const id = `${kind}\n${key}`;
    if (!counts.has(id) && counts.size >= MAX_KEYS) return;
    const count = (counts.get(id) ?? 0) + 1;
    counts.set(id, count);
    if (!/^10*$/.test(String(count)) || sent >= MAX_EVENTS) return;
    sent += 1;
    emit("page.error", {
      kind,
      ...value,
      ...(count > 1 ? { count } : {}),
      route: location.pathname,
      url: redact.url(location.href),
    });
  };

  /** Name, cleaned message, and stack of an error or rejection reason. */
  const describe = (error: unknown, fallback = "") => {
    const like: ErrorLike =
      typeof error === "object" && error !== null ? error : {};
    const raw =
      typeof like.message === "string"
        ? like.message
        : typeof error === "string"
          ? error
          : fallback;
    const message = clean(raw, MAX_MESSAGE);
    // The stack repeats the raw message; replace it with the cleaned one.
    const stack =
      typeof like.stack === "string"
        ? redact
            .url(raw ? like.stack.split(raw).join(message ?? "") : like.stack)
            .slice(0, MAX_STACK)
        : undefined;
    return {
      ...(typeof like.name === "string"
        ? { name: like.name.slice(0, 100) }
        : {}),
      ...(message === undefined ? {} : { message }),
      ...(stack === undefined ? {} : { stack }),
    };
  };

  const onError = (event: Event) => {
    try {
      const target = event.target;
      if (target instanceof Element) {
        if (!target.matches(RESOURCE)) return;
        const source =
          (target as HTMLImageElement).currentSrc ||
          target.getAttribute("src") ||
          target.getAttribute("href") ||
          "";
        const url = redact.url(source);
        report("resource", url, { tag: target.localName, source: url });
        return;
      }
      if (!(event instanceof ErrorEvent)) return;
      const fields = describe(event.error, event.message);
      report("uncaught", `${fields.name}: ${fields.message}`, {
        ...fields,
        ...(event.filename ? { source: redact.url(event.filename) } : {}),
        ...(event.lineno ? { line: event.lineno, column: event.colno } : {}),
      });
    } catch {
      // Capture must never change how the host app handles its errors.
    }
  };

  const onRejection = (event: Event) => {
    try {
      const reason = (event as PromiseRejectionEvent).reason as unknown;
      const fields = describe(reason);
      report("rejection", `${fields.name}: ${fields.message}`, {
        ...fields,
        ...(typeof reason === "object" && reason !== null
          ? {}
          : { reasonType: reason === null ? "null" : typeof reason }),
      });
    } catch {
      // Capture must never change how the host app handles its errors.
    }
  };

  const onInvalid = (event: Event) => {
    try {
      const field = event.target;
      if (!(field instanceof Element) || describeTarget(field, redact) === null)
        return;
      const validity = (field as HTMLInputElement).validity;
      const failed = VALIDITY.filter((flag) => validity?.[flag] === true);
      const label = fieldLabel(field, redact);
      const message = clean(
        (field as HTMLInputElement).validationMessage,
        MAX_MESSAGE,
      );
      report("invalid", `${label}\n${failed.join()}`, {
        ...(label === undefined ? {} : { label }),
        failed,
        ...(message === undefined ? {} : { validationMessage: message }),
      });
    } catch {
      // Capture must never block form validation in the host app.
    }
  };

  const onMutations = (records: MutationRecord[]) => {
    try {
      const regions = new Set<Element>();
      for (const record of records) {
        const node = record.target;
        const element = node instanceof Element ? node : node.parentElement;
        const region = element?.closest(ALERT);
        if (region) regions.add(region);
        for (const added of Array.from(record.addedNodes))
          if (added instanceof Element)
            for (const match of [
              ...(added.matches(ALERT) ? [added] : []),
              ...Array.from(added.querySelectorAll(ALERT)),
            ])
              regions.add(match);
      }
      for (const region of regions) {
        if (describeTarget(region, redact) === null) continue;
        const text = clean(region.textContent, MAX_ALERT);
        if (text !== undefined) report("alert", text, { text });
      }
    } catch {
      // Capture must never break rendering in the host app.
    }
  };

  window.addEventListener("error", onError, true);
  window.addEventListener("unhandledrejection", onRejection);
  window.addEventListener("invalid", onInvalid, true);
  let observer: MutationObserver | undefined;
  try {
    observer = new MutationObserver(onMutations);
    observer.observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  } catch {
    observer = undefined;
  }
  return () => {
    observer?.disconnect();
    window.removeEventListener("error", onError, true);
    window.removeEventListener("unhandledrejection", onRejection);
    window.removeEventListener("invalid", onInvalid, true);
  };
}
