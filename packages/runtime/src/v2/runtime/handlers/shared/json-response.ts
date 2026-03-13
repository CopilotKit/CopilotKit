export const errorResponse = (message: string, status: number) =>
  Response.json({ error: message }, { status });
