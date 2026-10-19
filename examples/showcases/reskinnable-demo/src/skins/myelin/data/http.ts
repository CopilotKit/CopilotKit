/**
 * Shared plumbing for the `/api/myelin/v1/*` routes: who is acting, JSON body
 * decoding, and ONE code → status/message table.
 *
 * The messages are symptom-only on purpose. `AUDIENCE_OVERLAP` says what is
 * wrong and never how to clear it — the fix is something the agent has to be
 * taught (the teach-a-skill beat), so it must not leak through a refusal.
 */

const CODES: Map<string, { status: number; message: string }> = new Map([
  ["NOT_FOUND", { status: 404, message: "That journey does not exist." }],
  [
    "UNKNOWN_ITEM",
    { status: 404, message: "That item is not in this journey." },
  ],
  ["UNKNOWN_GROUP", { status: 400, message: "That group does not exist." }],
  ["UNKNOWN_ADMIN", { status: 400, message: "Unknown admin." }],
  [
    "INVALID_INPUT",
    {
      status: 400,
      message: "Some of the values sent were missing or out of range.",
    },
  ],
  [
    "INVALID_KIND",
    {
      status: 400,
      message:
        "Item kind must be one of microlesson, video, quiz, checklist, observation, certification.",
    },
  ],
  [
    "DEPENDENCY_CYCLE",
    {
      status: 409,
      message:
        "That dependency would create a loop: an item cannot (indirectly) depend on itself.",
    },
  ],
  [
    "JOURNEY_PUBLISHED",
    {
      status: 409,
      message: "This journey is already published and can no longer be edited.",
    },
  ],
  [
    "JOURNEY_EMPTY",
    {
      status: 409,
      message: "A journey needs at least one item before it can be published.",
    },
  ],
  [
    "NO_AUDIENCE",
    {
      status: 409,
      message:
        "A journey needs at least one assigned group before it can be published.",
    },
  ],
  [
    "AUDIENCE_OVERLAP",
    {
      status: 409,
      message:
        "Publish blocked by the audience check: some learners in this audience are already enrolled in another active journey, which breaks Harvest Lane's one-onboarding-journey-at-a-time policy.",
    },
  ],
  [
    "RULE_EXCLUDE_BLOCKED",
    {
      status: 422,
      message:
        "Refused: food safety training is mandatory for every associate in this audience, so learners cannot be excluded from it.",
    },
  ],
  [
    "RULE_CAP_LOCKED",
    {
      status: 422,
      message:
        "Refused: one onboarding journey at a time is Harvest Lane HR policy and cannot be overridden per journey.",
    },
  ],
  [
    "UNKNOWN_RULE",
    {
      status: 422,
      message:
        "Refused: that is not an audience rule this platform recognises.",
    },
  ],
]);

export function errorResponse(
  error: unknown,
  extra?: Record<string, unknown>,
): Response {
  const code = error instanceof Error ? error.message : "";
  const known = CODES.get(code);
  if (known)
    return Response.json(
      { error: code, message: known.message, ...extra },
      { status: known.status },
    );
  console.error("[myelin] unexpected route error", error);
  return Response.json(
    { error: "INTERNAL", message: "Something went wrong on the server." },
    { status: 500 },
  );
}

/** Admin id from the `x-myelin-actor` header, or "agent". Defaults to Priya. */
export function actorFrom(req: Request): string {
  const raw = req.headers.get("x-myelin-actor")?.trim();
  return raw && /^[a-z0-9-]{1,40}$/.test(raw) ? raw : "adm-priya";
}

export async function jsonBody<T = Record<string, unknown>>(
  req: Request,
): Promise<T> {
  try {
    const body = (await req.json()) as unknown;
    if (body && typeof body === "object" && !Array.isArray(body))
      return body as T;
  } catch {
    // fall through to the refusal
  }
  throw new Error("INVALID_INPUT");
}

export function asStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string"))
    throw new Error("INVALID_INPUT");
  return value as string[];
}
