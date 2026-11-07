import { NextRequest } from "next/server";

// Forwards the browser's file requests to the agent server's file routes, so
// uploads follow AGENT_URL like the chat does and the browser only talks to
// this app. Only the file endpoints are reachable through this route.
const FILE_ROUTES = new Set(["process-file", "files", "file"]);

function agentUrl() {
  return (
    process.env.AGENT_URL ||
    process.env.LANGGRAPH_DEPLOYMENT_URL ||
    "http://localhost:8000"
  );
}

async function forward(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  if (!FILE_ROUTES.has(path[0]) || path.some((segment) => segment === "." || segment === "..")) {
    return Response.json({ detail: "Not found" }, { status: 404 });
  }

  const target = new URL(
    path.map(encodeURIComponent).join("/"),
    agentUrl().replace(/\/?$/, "/"),
  );

  const headers = new Headers();
  for (const name of ["authorization", "content-type"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const response = await fetch(target, {
    method: request.method,
    headers,
    body: request.method === "GET" ? undefined : await request.arrayBuffer(),
  });

  return new Response(response.body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json",
    },
  });
}

export { forward as GET, forward as POST, forward as DELETE };
