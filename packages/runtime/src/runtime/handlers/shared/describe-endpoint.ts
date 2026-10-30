/**
 * A form of the endpoint that is safe to write to application logs.
 *
 * Both halves of an endpoint URL can carry a secret: userinfo, and the query
 * string — the #2407 reporter's own workaround appended `?uid=<hash of the
 * API key>`. Only the origin and path survive.
 *
 * Used for anything that leaves this process with an endpoint in it: log
 * lines, and the tool descriptions that go to the model provider.
 */
export function describeEndpoint(endpoint: string | undefined): string {
  if (!endpoint) return "an MCP endpoint";
  try {
    const url = new URL(endpoint);
    // Not `url.origin`: for any scheme other than http(s) that is the opaque
    // origin, the literal string "null", and `pathname` is empty — so a
    // `stdio://` endpoint would render as "null" in a log and in a prompt.
    // Rebuilding from protocol and host keeps every scheme legible while
    // still dropping userinfo, query, and fragment.
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return "an MCP endpoint";
  }
}
