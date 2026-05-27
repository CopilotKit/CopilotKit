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
 * Default mapping from a captured HTTP exchange to a user-action. Mechanical by
 * design: the title is `"<METHOD> <pathname>"`, the request body becomes
 * `newData`, and url/status/duration (plus the response body when captured)
 * land in `metadata`. Teams that want semantic titles supply a `transform`.
 */
export function defaultMapToAction(
  captured: CapturedRequest,
  captureResponseBody: boolean,
): AutoCapturedUserAction {
  const metadata: Record<string, unknown> = {
    url: captured.url,
    status: captured.status,
    durationMs: captured.durationMs,
  };
  if (captureResponseBody && captured.responseBody !== undefined) {
    metadata.responseBody = captured.responseBody;
  }

  return {
    title: `${captured.method} ${safePathname(captured.url)}`,
    newData: captured.requestBody,
    metadata,
  };
}
