import * as store from "@/lib/store";
import type { NextRequest } from "next/server";

// Finalize (auto-approve) a draft policy exception, linking it to its
// transaction so the policy-limit gate is lifted when the code justifies it.
export const POST = async (
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;
    const approved = store.finalizePolicyException(id);
    return new Response(JSON.stringify(approved), { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "NOT_FOUND") {
      return new Response(
        JSON.stringify({ error: "NOT_FOUND", message: "Exception not found" }),
        { status: 404, headers: { "content-type": "application/json" } },
      );
    }
    if (message === "ALREADY_FINALIZED") {
      return new Response(
        JSON.stringify({
          error: "BAD_REQUEST",
          message: "Exception already finalized.",
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }
    console.error("POST Request error", error);
    return new Response(
      JSON.stringify({ error: "BAD_REQUEST", message: "Bad request" }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
};
