import type { AutoCaptureBridge } from "./bridge";
import {
  formDataToObject,
  formUrlEncodedToObject,
  parseBodyText,
  toAbsoluteUrl,
} from "./parse";

const XHR_PATCHED = Symbol.for("copilotkit.autoCapture.xhrPatched");
const XHR_ORIGINAL_OPEN = Symbol.for("copilotkit.autoCapture.xhrOriginalOpen");
const XHR_ORIGINAL_SEND = Symbol.for("copilotkit.autoCapture.xhrOriginalSend");

const now = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

interface XhrCapture {
  method: string;
  url: string;
}

type CapturingXhr = XMLHttpRequest & { __cpkCapture?: XhrCapture };

type PatchableXhrProto = XMLHttpRequest & {
  [XHR_PATCHED]?: boolean;
  [XHR_ORIGINAL_OPEN]?: XMLHttpRequest["open"];
  [XHR_ORIGINAL_SEND]?: XMLHttpRequest["send"];
};

let originalOpen: XMLHttpRequest["open"] | null = null;
let originalSend: XMLHttpRequest["send"] | null = null;

const readXhrRequestBody = (
  body: Document | XMLHttpRequestBodyInit | null | undefined,
): unknown => {
  if (body == null) return undefined;
  if (typeof body === "string") return parseBodyText(body, null);
  if (
    typeof URLSearchParams !== "undefined" &&
    body instanceof URLSearchParams
  ) {
    return formUrlEncodedToObject(body.toString());
  }
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    return formDataToObject(body);
  }
  return undefined;
};

const readXhrResponse = (
  xhr: XMLHttpRequest,
  contentType: string | null,
): unknown => {
  try {
    if (xhr.responseType === "" || xhr.responseType === "text") {
      return parseBodyText(xhr.responseText, contentType);
    }
    if (xhr.responseType === "json") {
      return xhr.response;
    }
    return undefined;
  } catch {
    return undefined;
  }
};

/** Install the global `XMLHttpRequest` patch (idempotent, browser-only). */
export function patchXHR(bridge: AutoCaptureBridge): void {
  if (typeof window === "undefined" || typeof XMLHttpRequest === "undefined") {
    return;
  }
  const proto = XMLHttpRequest.prototype as PatchableXhrProto;
  if (proto[XHR_PATCHED]) {
    // Already patched (e.g. by a prior module instance / HMR); recover the
    // originals from the prototype so a later restore still works.
    originalOpen = proto[XHR_ORIGINAL_OPEN] ?? originalOpen;
    originalSend = proto[XHR_ORIGINAL_SEND] ?? originalSend;
    return;
  }

  originalOpen = XMLHttpRequest.prototype.open;
  originalSend = XMLHttpRequest.prototype.send;
  proto[XHR_ORIGINAL_OPEN] = originalOpen;
  proto[XHR_ORIGINAL_SEND] = originalSend;
  // Narrowed views of the original `open`, one per overload. TypeScript's
  // overload resolution through `.call` defaults to the most-specific
  // signature, so calling `.call(this, method, url)` with only two args
  // gets routed at the 5-arg overload and errors. The two typed
  // assignments below sit at the boundary — TS verifies each is a safe
  // narrowing of the overloaded original — and let each call site pick
  // the right overload precisely, with no cast.
  const capturedOpen2: (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
  ) => void = originalOpen;
  const capturedOpen5: (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async: boolean,
    username?: string | null,
    password?: string | null,
  ) => void = originalOpen;
  const capturedSend = originalSend;

  XMLHttpRequest.prototype.open = function patchedOpen(
    method: string,
    url: string | URL,
    ...rest: [] | [boolean, (string | null)?, (string | null)?]
  ): void {
    const xhr = this as CapturingXhr;
    try {
      xhr.__cpkCapture = {
        method: String(method),
        url: toAbsoluteUrl(String(url)),
      };
    } catch {
      // ignore — capture metadata is best-effort
    }
    // Branch on the rest tuple so each call site matches one of the two
    // open overloads exactly — 2-arg or 5-arg. This preserves the caller's
    // original call shape (so `async` stays implicit when omitted, per the
    // XHR spec) and keeps the pass-through fully typed.
    if (rest.length === 0) {
      capturedOpen2.call(this, method, url);
    } else {
      const [async, user, password] = rest;
      capturedOpen5.call(this, method, url, async, user, password);
    }
  };

  XMLHttpRequest.prototype.send = function patchedSend(
    body?: Document | XMLHttpRequestBodyInit | null,
  ): void {
    const xhr = this as CapturingXhr;
    const capture = xhr.__cpkCapture;
    if (capture && bridge.enabled && bridge.dispatch) {
      const dispatch = bridge.dispatch;
      const start = now();
      xhr.addEventListener("loadend", (event) => {
        try {
          const target = event.currentTarget as XMLHttpRequest;
          const contentType = target.getResponseHeader("content-type");
          dispatch({
            method: capture.method,
            url: capture.url,
            requestBody: readXhrRequestBody(body),
            status: target.status,
            responseBody: readXhrResponse(target, contentType),
            durationMs: now() - start,
          });
        } catch {
          // capture must never affect the request
        }
      });
    }
    capturedSend.call(this, body);
  };

  proto[XHR_PATCHED] = true;
}

/**
 * Restore the original `XMLHttpRequest` methods. Recovers the originals from
 * the prototype when the module-level references were lost, so restore is
 * reliable across module re-instantiation.
 */
export function restoreXHR(): void {
  if (typeof XMLHttpRequest === "undefined") return;
  const proto = XMLHttpRequest.prototype as PatchableXhrProto;
  const open = originalOpen ?? proto[XHR_ORIGINAL_OPEN] ?? null;
  const send = originalSend ?? proto[XHR_ORIGINAL_SEND] ?? null;
  if (open) XMLHttpRequest.prototype.open = open;
  if (send) XMLHttpRequest.prototype.send = send;
  delete proto[XHR_PATCHED];
  delete proto[XHR_ORIGINAL_OPEN];
  delete proto[XHR_ORIGINAL_SEND];
  originalOpen = null;
  originalSend = null;
}
