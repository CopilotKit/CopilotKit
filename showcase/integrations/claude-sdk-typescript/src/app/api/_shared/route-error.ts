import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

export function internalRuntimeErrorResponse(route: string, error: unknown) {
  const err = error instanceof Error ? error : new Error(String(error));
  const errorId = randomUUID();

  console.error(
    JSON.stringify({
      at: new Date().toISOString(),
      level: "error",
      route,
      errorId,
      message: err.message,
      stack: err.stack,
    }),
  );

  return NextResponse.json(
    { error: "internal runtime error", errorId },
    { status: 500 },
  );
}
