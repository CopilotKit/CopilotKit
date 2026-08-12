import type { NextRequest } from "next/server";
import type { Card } from "../data";
import { generateUniqueId } from "../data";
import * as store from "@/lib/store";

export const GET = async () => {
  return new Response(JSON.stringify(store.cards()), { status: 200 });
};

export const POST = async (req: NextRequest) => {
  try {
    // Handle new card creation
    const body = await req.json();
    const { last4, expiry, type, color, pin } = body;
    const newCard: Card = {
      id: generateUniqueId(),
      last4,
      expiry,
      type,
      color,
      pin,
      expensePolicyId: "8r5c3m4n5o",
    }; // Ensure all required fields are included
    store.addCard(newCard);
    return new Response(JSON.stringify(newCard), { status: 201 });
  } catch (error) {
    console.error("POST Request error", error);
  }
};
