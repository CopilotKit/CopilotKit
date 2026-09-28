import {
  handleInspectorAsk,
  inspectorAskEnvelopeSchema,
} from "./handle-inspector-ask";
import type {
  CopilotRuntimeLike,
  IntelligenceAccessGrant,
} from "../core/runtime";
import { isIntelligenceRuntime } from "../core/runtime";
import { PlatformRequestError } from "../intelligence-platform/client";
import { parseInspectorReadRequest } from "./shared/inspector-read-request";
import { resolveIntelligenceUser } from "./shared/resolve-intelligence-user";
import { resolveIntelligenceGrant } from "./shared/resolve-intelligence-grant";
import {
  InspectorBodyTooLargeError,
  readInspectorJson,
} from "./shared/bounded-inspector-json";

const headers = { "Cache-Control": "no-store, private" };
const error = (status: number, message: string) =>
  Response.json({ error: message }, { status, headers });

/** Compares permission sets without depending on policy object or agent ordering. */
function grantKey(grant: IntelligenceAccessGrant | undefined): string {
  return JSON.stringify(
    Object.entries(grant?.permissions ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([permission, scope]) => [
        permission,
        scope.agents === "*" ? "*" : [...scope.agents].sort(),
      ]),
  );
}

/** Serves permission-scoped reads for the embedded Intelligence views. */
export async function handleInspectorIntelligence({
  runtime,
  request,
}: {
  readonly runtime: CopilotRuntimeLike;
  readonly request: Request;
}): Promise<Response> {
  if (!isIntelligenceRuntime(runtime)) return error(404, "Not found");
  const user = await resolveIntelligenceUser({ runtime, request });
  if (user instanceof Response) return user;
  let body: unknown;
  try {
    body = await readInspectorJson(request.body, 65_536);
  } catch (cause) {
    return error(
      cause instanceof InspectorBodyTooLargeError ? 413 : 400,
      "Invalid Inspector request",
    );
  }
  const ask = inspectorAskEnvelopeSchema.safeParse(body);
  const read = parseInspectorReadRequest(body);
  if (!read && !ask.success) return error(400, "Invalid Inspector request");
  const grant = await resolveIntelligenceGrant({
    runtime,
    request,
    user,
    surface: "inspector",
  });
  if (grant instanceof Response) return grant;
  if (read?.path === "/context") {
    if (
      !grant ||
      !Object.values(grant.permissions).some(
        (scope) => scope && (scope.agents === "*" || scope.agents.length > 0),
      )
    )
      return error(403, "Access denied");
    const agents = Object.keys(await runtime.agents).filter((id) =>
      Object.values(grant.permissions).some(
        (scope) => scope?.agents === "*" || scope?.agents.includes(id),
      ),
    );
    return Response.json(
      {
        version: 1,
        grant,
        agents,
        askAvailable: runtime.intelligence.ɵgetAskModel() !== undefined,
      },
      { headers },
    );
  }
  try {
    if (ask.success)
      return await handleInspectorAsk({
        runtime,
        request,
        userId: user.id,
        grant,
        body: ask.data.body,
        assertGrantCurrent: async () => {
          const current = await resolveIntelligenceGrant({
            runtime,
            request,
            user,
            surface: "inspector",
            refresh: true,
          });
          if (current instanceof Response)
            throw new PlatformRequestError(
              "Access unavailable",
              current.status,
              false,
            );
          if (grantKey(current) !== grantKey(grant))
            throw new PlatformRequestError("Access changed", 403, false);
        },
      });
    if (!read) return error(400, "Invalid Inspector request");
    const result = await runtime.intelligence.requestInspectorRead(
      read,
      { userId: user.id, grant },
      request.signal,
    );
    if (result instanceof Response) return result;
    return Response.json(result, { headers });
  } catch (cause) {
    if (cause instanceof PlatformRequestError) {
      const status = [400, 401, 403, 404, 409, 410, 413, 422, 429].includes(
        cause.status,
      )
        ? cause.status
        : 503;
      return error(
        status,
        status === 401 || status === 403
          ? "Access denied"
          : "Intelligence read unavailable",
      );
    }
    return error(503, "Intelligence read unavailable");
  }
}
