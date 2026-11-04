/**
 * useComponent tools are render-only, so CopilotKit reports them back with an
 * empty tool result. The Managed Agents API rejects an empty text block
 * ("value is required"), so give those results a body on the way in. Remove
 * once @ag-ui/claude-managed-agents (> 0.0.1) does this itself.
 */
export async function fillEmptyToolResults(req: Request): Promise<Request> {
  if (req.method !== "POST") return req;
  const text = await req.text();
  const headers = new Headers(req.headers);
  headers.delete("content-length");
  try {
    const body = JSON.parse(text);
    // Multi-route transport posts RunAgentInput directly; single-route wraps it in { method, body }.
    for (const m of body?.messages ?? body?.body?.messages ?? []) {
      if (
        m?.role === "tool" &&
        !(typeof m.content === "string" && m.content.trim())
      )
        m.content = "Rendered in the UI.";
    }
    return new Request(req.url, {
      method: "POST",
      headers,
      signal: req.signal,
      body: JSON.stringify(body),
    });
  } catch {
    return new Request(req.url, {
      method: "POST",
      headers,
      signal: req.signal,
      body: text,
    });
  }
}
