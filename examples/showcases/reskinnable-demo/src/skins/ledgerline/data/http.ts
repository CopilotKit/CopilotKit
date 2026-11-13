import { LedgerError } from "./store";

const STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  POLICY_HOLD: 409,
  ALREADY_APPROVED: 409,
  ALREADY_REIMBURSED: 409,
  NOT_SUBMITTED: 409,
  NOT_APPROVED: 409,
  UNKNOWN_COST_CENTER: 422,
  LOCKED: 409,
  INVALID_NOTE: 422,
  BAD_REQUEST: 400,
  SESSION_REQUIRED: 409,
  SESSION_NOT_FOUND: 404,
  SESSION_CLOSED: 409,
  INVALID_TRANSACTION: 422,
  INVALID_RECEIPT: 422,
  PERIOD_NOT_OPEN: 409,
  PERIOD_CLOSED: 409,
  VALIDATION_REQUIRED: 409,
  VALIDATION_FAILED: 409,
};

/** A store refusal as JSON: `{ error, message, ...detail }`. */
export function errorResponse(error: unknown, where: string): Response {
  if (error instanceof LedgerError) {
    return Response.json(
      { error: error.code, message: error.message, ...error.detail },
      { status: STATUS[error.code] ?? 400 },
    );
  }
  console.error(`[ledgerline] ${where} failed`, error);
  return Response.json(
    { error: "INTERNAL", message: "Something went wrong on the server." },
    { status: 500 },
  );
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await req.json()) as unknown;
    return body && typeof body === "object"
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
