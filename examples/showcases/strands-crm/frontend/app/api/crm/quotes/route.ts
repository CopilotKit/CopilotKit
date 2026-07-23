import { NextResponse } from "next/server";

const AGENT_URL = process.env.AGENT_URL ?? "http://localhost:8000";

// Persist an approved hardware quote via the agent's store, returning the saved
// quote (with a server-assigned id) so the UI can route to its full page.
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  try {
    const res = await fetch(`${AGENT_URL}/crm/quotes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "agent unreachable" }, { status: 502 });
  }
}
