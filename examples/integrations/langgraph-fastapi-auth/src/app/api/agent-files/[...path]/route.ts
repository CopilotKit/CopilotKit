import { NextRequest } from "next/server";

// Forwards the browser's file requests to the agent server's file routes, so
// uploads follow AGENT_URL like the chat does and the browser only talks to
// this app. Only the file endpoints are reachable through this route.
const FILE_ROUTES = new Set(["process-file", "files", "file"]);

// Uploads arrive as base64 JSON (about 4/3 of the file size), so this allows
// files up to roughly 15 MB.
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

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

  // Only uploads carry a body. Check its declared size up front, then stream it
  // to the agent instead of buffering the whole upload in memory.
  const hasBody = request.method === "POST";
  if (hasBody) {
    const length = Number(request.headers.get("content-length"));
    if (!length) {
      return Response.json({ detail: "Content-Length is required" }, { status: 411 });
    }
    if (length > MAX_UPLOAD_BYTES) {
      return Response.json({ detail: "File is too large to upload" }, { status: 413 });
    }
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
    ...(hasBody ? { body: request.body, duplex: "half" } : {}),
  } as RequestInit);

  return new Response(response.body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json",
    },
  });
}

export { forward as GET, forward as POST, forward as DELETE };
