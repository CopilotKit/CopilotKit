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
 */
export function platformErrorResponse(
  error: unknown,
  message: string,
): Response {
  if (error instanceof PlatformRequestError) {
    const { status } = error;
    if (Number.isInteger(status) && status >= 400 && status <= 499) {
      return errorResponse(message, status);
    }
    return errorResponse(message, 502);
  }
  return errorResponse(message, 500);
}

/**
 * True when the platform said specifically "no such thread".
 *
 * On a READ, that is not a failure: a conversation that has not been spoken in
 * yet has no events, no messages and no state, and the client asks for all
 * three the moment a fresh chat mounts. Reporting it as a server error put a
 * 500 in the browser console on every new conversation — which is worse than
 * noise, because it made a genuinely broken run look exactly like the normal
 * case, and a reader who has learned to ignore the red badge cannot see the
 * real one underneath it.
 *
 * Deliberately NOT applied to the mutation paths. Renaming, archiving or
 * deleting a thread that does not exist IS a client error, and 404 is the
 * useful answer there.
 */
export function isThreadNotFound(error: unknown): boolean {
  return error instanceof PlatformRequestError && error.status === 404;
}
