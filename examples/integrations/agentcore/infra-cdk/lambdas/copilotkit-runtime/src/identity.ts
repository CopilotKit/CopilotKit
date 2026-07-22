export const VERIFIED_RUNTIME_USER_HEADER =
  "x-copilotkit-verified-user-id" as const;

export interface RuntimeUserIdentity {
  readonly id: string;
  readonly name: string;
}

export interface ApiGatewayRuntimeEvent {
  readonly headers?: Readonly<Record<string, string | undefined>> | null;
  readonly multiValueHeaders?: Readonly<
    Record<string, readonly string[] | undefined>
  > | null;
  readonly requestContext?: {
    readonly authorizer?: {
      readonly claims?: Readonly<Record<string, unknown>> | null;
    } | null;
  } | null;
  readonly [key: string]: unknown;
}

/**
 * Replace any caller-supplied private header with the Cognito claim that API
 * Gateway verified. A missing claim removes the header so the Runtime denies it.
 */
export function withVerifiedRuntimeUserHeader(
  event: ApiGatewayRuntimeEvent,
): ApiGatewayRuntimeEvent {
  const headers = Object.fromEntries(
    Object.entries(event.headers ?? {}).filter(
      ([name]) => name.toLowerCase() !== VERIFIED_RUNTIME_USER_HEADER,
    ),
  );
  const multiValueHeaders = Object.fromEntries(
    Object.entries(event.multiValueHeaders ?? {}).filter(
      ([name]) => name.toLowerCase() !== VERIFIED_RUNTIME_USER_HEADER,
    ),
  );
  const subject = event.requestContext?.authorizer?.claims?.sub;
  if (typeof subject === "string" && subject.trim()) {
    headers[VERIFIED_RUNTIME_USER_HEADER] = subject.trim();
  }

  return {
    ...event,
    headers,
    ...(event.multiValueHeaders ? { multiValueHeaders } : {}),
  };
}

/**
 * Resolve the Cognito subject that API Gateway mapped onto its private header.
 * The deployed runtime has no anonymous or shared-user fallback.
 */
export function resolveVerifiedRuntimeUser(
  request: Request,
): RuntimeUserIdentity {
  const id = request.headers.get(VERIFIED_RUNTIME_USER_HEADER)?.trim();
  if (!id) {
    throw new Error("Verified Runtime user identity is required");
  }

  return { id, name: id };
}

/** Resolve a verified user, with an explicit fallback for the local server only. */
export function resolveLocalRuntimeUser(request: Request): RuntimeUserIdentity {
  try {
    return resolveVerifiedRuntimeUser(request);
  } catch {
    return { id: "local-demo-user", name: "Local Demo User" };
  }
}
