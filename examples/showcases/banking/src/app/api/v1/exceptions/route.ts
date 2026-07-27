import type { NextRequest } from "next/server";
import * as store from "@/lib/store";

// Open a draft policy exception against a transaction.
export const POST = async (req: NextRequest) => {
  let code: string | undefined;
  try {
    const body = await req.json();
    code = body?.code;
    const exception = store.openPolicyException(
      body?.transactionId,
      code as string,
    );
    return new Response(JSON.stringify(exception), { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "NOT_FOUND") {
      return new Response(
        JSON.stringify({
          error: "NOT_FOUND",
          message: "Transaction not found",
        }),
        { status: 404, headers: { "content-type": "application/json" } },
      );
    }
    if (message === "INVALID_EXCEPTION_CODE") {
      // Surface-level rejection. We deliberately do NOT enumerate the valid
      // codes here — that would itself be a hint. The agent has to find the
      // catalogue on its own via `/knowledge`.
      return new Response(
        JSON.stringify({
          error: "INVALID_EXCEPTION_CODE",
          message: `"${code}" is not a recognized policy exception code.`,
        }),
        { status: 422, headers: { "content-type": "application/json" } },
      );
    }
    console.error("POST Request error", error);
    return new Response(
      JSON.stringify({ error: "BAD_REQUEST", message: "Bad request" }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
};
