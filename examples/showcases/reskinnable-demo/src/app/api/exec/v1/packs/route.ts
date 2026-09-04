import { z } from "zod";
import * as store from "@/skins/exec/data/store";

const PublishPackBody = z.object({
  dashboardId: z.enum(["ceo", "cfo"]),
  countersignPin: z.string(),
});

/**
 * BEAT — publishing a board pack is gated on countersign PIN first, then on
 * unexplained variance. `store.publishPack` returns a discriminated result;
 * this route is a thin transport shell over it and must forward `code`
 * VERBATIM — the agent reads the refusal back and the teach loop depends on
 * `UNEXPLAINED_VARIANCE` reaching the client as the literal string, not a
 * re-worded message or a generic 500.
 *
 * Each refusal arm carries a DIFFERENT payload beside `code` — `breaches` for
 * `UNEXPLAINED_VARIANCE`, a human `message` for `EMPTY_DASHBOARD` and
 * `NOT_FOUND`, neither for `BAD_COUNTERSIGN` — so both are spread
 * conditionally rather than read off a fixed shape. Dropping `message` is not
 * cosmetic: `EMPTY_DASHBOARD` is the one code the receipt has no phrasing of
 * its own for (`REFUSAL_PHRASES` in `../../../../../skins/exec/tools.tsx`), so
 * without it the room reads the enum spelled as words instead of the sentence
 * saying what the pack lacks. `BAD_COUNTERSIGN` still answers `{ error }` and
 * NOTHING else — the PIN gate runs first precisely so a bad countersign learns
 * nothing, and this spread must never grow it a body.
 */
export const POST = async (req: Request) => {
  const raw = await req.json().catch(() => null);
  const parsed = PublishPackBody.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      {
        error: "BAD_REQUEST",
        message: "Invalid publish-pack payload.",
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  const result = store.publishPack(
    parsed.data.dashboardId,
    parsed.data.countersignPin,
  );

  if (!result.ok) {
    return Response.json(
      {
        error: result.code,
        ...("message" in result ? { message: result.message } : {}),
        ...("breaches" in result ? { breaches: result.breaches } : {}),
      },
      { status: result.status },
    );
  }

  return Response.json(result.pack, { status: 200 });
};
