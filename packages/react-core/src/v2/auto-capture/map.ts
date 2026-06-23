import type { AutoCapturedUserAction, CapturedRequest } from "./types";

/** Best-effort `pathname` for a URL; falls back to the raw string. */
const safePathname = (url: string): string => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};

/**
 * Default mapping from a captured HTTP exchange to a learn-from-user-action
 * input. Mechanical by design: the title is `"<METHOD> <pathname>"` and the
 * full exchange — url, status, duration, request body, and (when captured) the
 * response body — lands in the flat `data` snapshot understood by the
 * Intelligence annotate pipeline. Teams that want semantic titles supply a
 * `transform`.
 */
export function defaultMapToAction(
  captured: CapturedRequest,
  captureResponseBody: boolean,
): AutoCapturedUserAction {
  const data: Record<string, unknown> = {
    url: captured.url,
    status: captured.status,
    durationMs: captured.durationMs,
    requestBody: captured.requestBody,
  };
  if (captureResponseBody && captured.responseBody !== undefined) {
    data.responseBody = captured.responseBody;
  }

  return {
    title: `${captured.method} ${safePathname(captured.url)}`,
    data,
  };
}
