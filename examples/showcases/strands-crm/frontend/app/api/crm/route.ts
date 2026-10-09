import { NextResponse } from "next/server";

const AGENT_URL = process.env.AGENT_URL ?? "http://localhost:8000";
const EMPTY = {
  deals: [],
  accounts: [],
  contacts: [],
  activities: [],
  products: [],
  salespeople: [],
  reports: [],
  quotes: [],
};

// Proxy the agent's seeded CRM snapshot to the browser. The agent may be
// starting up or briefly unreachable; in that case return an empty snapshot
// (200) rather than a 500 so the board renders cleanly and the agent's live
// STATE_SNAPSHOTs populate it once it's up.
export async function GET() {
  try {
    const res = await fetch(`${AGENT_URL}/crm`, { cache: "no-store" });
    if (!res.ok) return NextResponse.json(EMPTY);
    const data = await res.json();
    return NextResponse.json(data && Array.isArray(data.deals) ? data : EMPTY);
  } catch {
    return NextResponse.json(EMPTY);
  }
}
