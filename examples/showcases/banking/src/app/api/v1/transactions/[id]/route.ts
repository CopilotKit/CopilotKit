import * as store from "@/lib/store";
import type { Transaction } from "../../data";
import type { NextRequest } from "next/server";

// Add note to transaction / update status
export const PUT = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;
    const existing = store.findTransaction(id);
    if (!existing) {
      return new Response(JSON.stringify({ error: "Transaction not found" }), {
        status: 404,
      });
    }
    const body = await req.json();
    const { content, userId, ...rest } = body;
    const patch: Partial<Transaction> = { ...rest };
    if (content && userId) {
      patch.note = {
        content,
        userId,
        date: new Date().toISOString().split("T")[0],
      };
    }
    const updated = store.updateTransaction(id, patch);
    return new Response(JSON.stringify(updated), { status: 201 });
  } catch (error) {
    console.error("PUT Request error", error);
  }
};
