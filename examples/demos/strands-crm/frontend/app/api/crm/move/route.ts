import { NextResponse } from "next/server";

const AGENT_URL = process.env.AGENT_URL ?? "http://localhost:8000";

export async function POST(req: Request) {
  let body: { dealId?: string; stage?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const { dealId, stage } = body;
  if (typeof dealId !== "string" || typeof stage !== "string") {
    return NextResponse.json(
      { error: "dealId and stage required" },
      { status: 400 },
    );
  }
  try {
    const res = await fetch(
      `${AGENT_URL}/crm/deals/${encodeURIComponent(dealId)}/stage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
        cache: "no-store",
      },
    );
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "agent unreachable" }, { status: 502 });
  }
}
