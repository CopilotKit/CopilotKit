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

  XMLHttpRequest.prototype.open = function patchedOpen(
    this: CapturingXhr,
    method: string,
    url: string | URL,
    async?: boolean,
    user?: string | null,
    password?: string | null,
  ): void {
    try {
      this.__cpkCapture = {
        method: String(method),
        url: toAbsoluteUrl(String(url)),
      };
    } catch {
      // ignore — capture metadata is best-effort
    }
    // Pass through to the original with the spec's exact signature. Using
    // `.call` (rather than `.apply` with a rest array) lets TypeScript pick
    // the matching overload directly, so no widening cast is needed.
    originalOpen.call(this, method, url, async ?? true, user, password);
  };

  XMLHttpRequest.prototype.send = function patchedSend(
    this: CapturingXhr,
    body?: Document | XMLHttpRequestBodyInit | null,
  ): void {
    const capture = this.__cpkCapture;
    if (capture && bridge.enabled && bridge.dispatch) {
      const dispatch = bridge.dispatch;
      const start = now();
      this.addEventListener("loadend", (event) => {
        try {
          const xhr = event.currentTarget as XMLHttpRequest;
          const contentType = xhr.getResponseHeader("content-type");
          dispatch({
            method: capture.method,
            url: capture.url,
            requestBody: readXhrRequestBody(body),
            status: xhr.status,
            responseBody: readXhrResponse(xhr, contentType),
            durationMs: now() - start,
          });
        } catch {
          // capture must never affect the request
        }
      });
    }
    originalSend.call(this, body);
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
