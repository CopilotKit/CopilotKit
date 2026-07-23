import * as store from "@/lib/store";
import type { NextRequest } from "next/server";

// Get policy per card
export const GET = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const card = store.findCard(id);
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
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;
    const card = store.findCard(id);
    if (!card) {
      return new Response(JSON.stringify({ error: "Card not found" }), {
        status: 404,
      });
    }
    const body = await req.json();
    const { policyId } = body;
    const updated = store.assignPolicyToCard(id, policyId);
    return new Response(JSON.stringify(updated), { status: 201 });
  } catch (error) {
    console.error("POST Request error", error);
  }
};
