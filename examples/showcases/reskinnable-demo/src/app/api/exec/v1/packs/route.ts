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
        ...("breaches" in result ? { breaches: result.breaches } : {}),
      },
      { status: result.status },
    );
  }

  return Response.json(result.pack, { status: 200 });
};
