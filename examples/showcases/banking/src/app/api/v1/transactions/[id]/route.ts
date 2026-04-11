import { data } from "../../data";
import { NextRequest } from "next/server";

// Add note to transaction
export const PUT = async (
  req: NextRequest,
  { params }: { params: { id: string } },
) => {
  try {
    const transaction = data.transactions.find((t) => t.id === params.id);
    if (!transaction) {
      return new Response(JSON.stringify({ error: "Transaction not found" }), {
        status: 404,
      });
    }
    const body = await req.json();
    const { content, userId, ...newTransactionDetails } = body;
    const newTransaction = { ...transaction, ...newTransactionDetails };
    if (content && userId) {
      newTransaction.note = {
        content,
        userId,
        date: new Date().toISOString().split("T")[0],
      };
    }
    data.transactions = data.transactions.map((t) => {
      if (t.id === params.id) {
        return newTransaction;
      }
      return t;
    });
    return new Response(JSON.stringify(newTransaction), { status: 201 });
  } catch (error) {
    console.error("PUT Request error", error);
  }
};
