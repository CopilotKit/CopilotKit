/**
 * Build the error for a failed runtime `/info` response, folding in whatever
 * explanation the runtime sent back.
 *
 * The status alone cannot distinguish a wrong `runtimeUrl` from a transport
 * mismatch, so the runtime answers the latter with a body naming the cause
 * (see the handler's `single_route_envelope_against_multi_route_runtime`
 * diagnostic). Discarding that body — as every `/info` caller used to — left
 * the developer with a bare 404 and nothing to act on (OSS-882).
 *
 * A body that isn't JSON, or carries no string `message`, contributes nothing:
 * the status is then the whole error.
 */
export async function runtimeInfoError(
  response: Response,
): Promise<RuntimeInfoRequestError> {
  const base = `Runtime info request failed with status ${response.status}`;

  let detail: string | undefined;
  try {
    const body: unknown = await response.clone().json();
    const message = (body as { message?: unknown } | null)?.message;
    if (typeof message === "string" && message.trim().length > 0) {
      detail = message.trim();
    }
  } catch {
    // Unparseable or already-consumed body — fall back to the status.
  }

  const error = new Error(
    detail ? `${base}: ${detail}` : base,
  ) as RuntimeInfoRequestError;
  error.runtimeInfoStatus = response.status;
  return error;
}

export interface RuntimeInfoRequestError extends Error {
  runtimeInfoStatus: number;
}

export function isRuntimeInfoRequestError(
  error: unknown,
): error is RuntimeInfoRequestError {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { runtimeInfoStatus?: unknown }).runtimeInfoStatus ===
      "number"
  );
}
