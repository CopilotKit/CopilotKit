import * as store from "@/lib/store";
import type { NextRequest } from "next/server";

// Get policy per card
export const GET = async (
  req: NextRequest,
  { params }: { params: { id: string } },
) => {
  const card = store.findCard(params.id);
  if (!card) {
    return new Response(JSON.stringify({ error: "Card not found" }), {
      status: 404,
    });
  }
  const policy = card.expensePolicyId
    ? store.findPolicy(card.expensePolicyId)
    : undefined;
  return new Response(JSON.stringify(policy), { status: 200 });
};

// Assign policy
export const POST = async (
  req: NextRequest,
  { params }: { params: { id: string } },
) => {
  try {
    const card = store.findCard(params.id);
    if (!card) {
      return new Response(JSON.stringify({ error: "Card not found" }), {
        status: 404,
      });
    }
    const body = await req.json();
    const { policyId } = body;
    const updated = store.assignPolicyToCard(params.id, policyId);
    return new Response(JSON.stringify(updated), { status: 201 });
  } catch (error) {
    console.error("POST Request error", error);
  }
};
