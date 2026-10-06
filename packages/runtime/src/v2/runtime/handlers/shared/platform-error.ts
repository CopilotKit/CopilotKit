import { PlatformRequestError } from "../../intelligence-platform/client";
import { errorResponse } from "./json-response";

/**
 * Map a thrown error from a platform call onto a `Response`.
 *
 * Extracted from the memory handlers, which had it first and alone; the thread
 * handlers flattened every failure to 500, so a "this does not exist yet" was
 * indistinguishable from "the platform is down". One copy, because two would
 * drift the moment either grew a case.
 *
 * Forward only client-actionable **4xx** statuses verbatim (404 missing or
 * wrong-scope, 409 conflict, 422 unprocessable) so a consumer can branch on
 * them — a flat 500 erases that distinction. A platform **5xx**, or any non-4xx
 * or malformed status, means this runtime is healthy but its dependency failed,
 * so it surfaces as `502 Bad Gateway` rather than echoing the upstream status as
 * if the runtime itself broke. That also avoids a `RangeError` from
 * `new Response(..., { status })` on an out-of-range status. Anything that is
 * not a platform error at all stays 500.
 *
 * A platform **401/403** is also 502: it rejects the runtime's own API key
 * (e.g. after a rotation), not the end user, so forwarding it would tell the
 * browser the user is unauthorized for a fault only the server can fix.
 */
export function platformErrorResponse(
  error: unknown,
  message: string,
): Response {
  if (error instanceof PlatformRequestError) {
    const { status } = error;
    const isCredentialRejection = status === 401 || status === 403;
    if (
      Number.isInteger(status) &&
      status >= 400 &&
      status <= 499 &&
      !isCredentialRejection
    ) {
      return errorResponse(message, status);
    }
    return errorResponse(message, 502);
  }
  return errorResponse(message, 500);
}
