export const errorResponse = (message: string, status: number) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export function isHandlerResponse(value: unknown): value is Response {
  return value instanceof Response;
}
