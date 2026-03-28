export const errorResponse = (message: string, status: number) =>
  Response.json({ error: message }, { status });

export function isHandlerResponse(value: unknown): value is Response {
  return value instanceof Response;
}
