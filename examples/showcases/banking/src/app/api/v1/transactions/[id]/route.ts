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
    // Policy-limit gate. `status` arrives inside `rest`, so apply the patch
    // to a merged view before checking. The rejection names ONLY the
    // symptom (the policy is over its limit) — never the policy-exception
    // path that lifts the gate. The agent has to learn that recipe from
    // `/knowledge`; leaking it here would defeat the SL demo.
    const merged = { ...existing, ...patch };
    if (
      patch.status === "approved" &&
      !store.isWithinPolicyLimit(merged) &&
      !store.hasApprovedException(merged)
    ) {
      return new Response(
        JSON.stringify({
          error: "OVER_POLICY_LIMIT",
          message: `${store.findPolicy(existing.policyId)?.type} policy limit exceeded`,
        }),
        { status: 422, headers: { "content-type": "application/json" } },
      );
    }
    const updated = store.updateTransaction(id, patch);
    return new Response(JSON.stringify(updated), { status: 201 });
  } catch (error) {
    console.error("PUT Request error", error);
  }
};
