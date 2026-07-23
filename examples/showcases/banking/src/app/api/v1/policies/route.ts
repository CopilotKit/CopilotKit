import type { NextRequest } from "next/server";
import * as store from "@/lib/store";

// Get policy per card
export const GET = async () => {
  return new Response(JSON.stringify(store.policies()), { status: 200 });
};

// Assign policy
export const POST = async (req: NextRequest) => {
  try {
    const body = await req.json();
    const { policyId, type, limit } = body;
    if (!policyId || !type || !limit) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400 },
      );
    }
    // Handle new policy creation
    const newPolicy = { id: policyId, type, limit, spent: 0 };
    store.addPolicy(newPolicy);
    return new Response(JSON.stringify(newPolicy), { status: 201 });
  } catch (error) {
    console.error("POST Request error", error);
  }
};
