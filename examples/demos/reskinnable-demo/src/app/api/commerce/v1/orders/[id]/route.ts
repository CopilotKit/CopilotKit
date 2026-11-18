import type { NextRequest } from "next/server";
import * as store from "@/skins/commerce/data/store";
import { errorResponse, readJsonBody } from "@/skins/commerce/data/http";
import type { OrderException, OrderStatus } from "@/skins/commerce/data/types";

const STATUSES: OrderStatus[] = ["open", "on-hold", "fulfilled", "cancelled"];
const EXCEPTIONS: OrderException[] = [
  "none",
  "fraud-review",
  "address-invalid",
  "oversell",
  "carrier-delay",
  "payment-declined",
];

/**
 * BEAT 5, step 1 — put an order on hold (and optionally restate why).
 *
 * The `id` accepts either the internal id or the human-facing order NUMBER; the
 * store resolves both. The agent reads "order 4471" out of the page context and
 * either spelling is a reasonable thing for it to send, so refusing one of them
 * would be a routing failure dressed up as a 404.
 *
 * This route validates the VOCABULARY only — that the strings name a real
 * status and a real exception. Which status changes are legal, and which
 * (status, exception) pairs an order may hold, is the state machine in
 * `store.orderStatusBlocker`, because that invariant belongs to the ledger and
 * not to one of its two writers. `setOrderStatus` throws a coded refusal and
 * `errorResponse` maps it (409 / 422); do NOT re-implement any of it here.
 *
 * `status` and `exception` are INDEPENDENTLY optional, and that independence is
 * load-bearing rather than convenience. A PATCH that always had to carry a status
 * forced the Orders page's "Clear the exception" button to send one, and the one
 * it sent (`open`) silently RELEASED any hold beat 5 had just placed — undoing
 * the first of the stored procedure's three writes while claiming only to have
 * cleared a flag. A request that names only the field it means cannot do that. At
 * least one of the two must be present: an empty PATCH is a caller bug, and
 * answering 200 to it would report a write that never happened.
 *
 * The body is decoded by `readJsonBody` BEFORE the `try` opens, so an unreadable
 * one is a deliberate 400 naming the order rather than a `SyntaxError` that
 * `errorResponse` cannot tell apart from a store defect.
 */
export const PATCH = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const parsed = await readJsonBody(req, "PATCH orders/[id]", id);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  try {
    // Presence, not truthiness: `exception: ""` is a malformed value, not an
    // omission, and must reach the vocabulary check below rather than be dropped.
    const hasStatus = body.status !== undefined && body.status !== null;
    const hasException =
      body.exception !== undefined && body.exception !== null;
    if (!hasStatus && !hasException) {
      return Response.json(
        {
          error: "BAD_REQUEST",
          message: "Provide a status, an exception, or both.",
        },
        { status: 400 },
      );
    }

    const status = String(body.status ?? "") as OrderStatus;
    if (hasStatus && !STATUSES.includes(status)) {
      return Response.json(
        { error: "BAD_REQUEST", message: "Unknown order status." },
        { status: 400 },
      );
    }
    const exception = String(body.exception ?? "") as OrderException;
    if (hasException && !EXCEPTIONS.includes(exception)) {
      return Response.json(
        { error: "BAD_REQUEST", message: "Unknown order exception." },
        { status: 400 },
      );
    }

    const updated = hasStatus
      ? store.setOrderStatus(id, status, hasException ? exception : undefined)
      : store.setOrderException(id, exception);
    return Response.json(updated, { status: 200 });
  } catch (error) {
    return errorResponse(error, `PATCH orders/[id] id=${id}`);
  }
};
