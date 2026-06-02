import type { NextRequest } from "next/server";
import * as store from "@/lib/store";

export const PUT = async (
  req: NextRequest,
  { params }: { params: { id: string } },
) => {
  try {
    const cardId = params.id;
    // Handle pin or card limit change
    const body = await req.json();
    console.info(
      `${req.method}: ${req.url} called with: ${JSON.stringify(body)}`,
    );
    const { pin } = body;
    if (!pin) {
      const card = store.findCard(cardId);
      if (!card) {
        return new Response(JSON.stringify({ error: "Card not found" }), {
          status: 404,
        });
      }
      return new Response(JSON.stringify(card), { status: 200 });
    }
    const updated = store.updateCardPin(cardId, pin);
    if (!updated) {
      return new Response(JSON.stringify({ error: "Card not found" }), {
        status: 404,
      });
    }
    return new Response(JSON.stringify(updated), { status: 200 });
  } catch (error) {
    console.error("PUT Request error", error);
  }
};
