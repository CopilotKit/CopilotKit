import * as store from "@/skins/keel/data/store";

/**
 * BEAT 6 — ratify a draft publication variance. The other half of the unlock.
 *
 * Auto-ratifies; there is no second review step in the demo. Ratifying LINKS the
 * variance to the document's pending revision, which is what can lift the
 * release gate — and a ratified DECOY links in exactly the same way and lifts
 * nothing. That is the demonstration working: the operator files under a
 * plausible wrong code, the release stays blocked with the same refusal, and the
 * room watches the difference between a code that is honest and a code that is
 * justifying.
 *
 * The response says nothing about whether this variance will actually unlock
 * anything. It cannot: that would publish the justifying/decoy split, which is
 * the very thing being withheld.
 */
export const POST = async (
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  try {
    return Response.json(store.ratifyVariance(id));
  } catch (err) {
    const reason = err instanceof Error ? err.message : "UNKNOWN";
    const status = reason === "NOT_FOUND" ? 404 : 409;
    return Response.json(
      { error: reason, message: `Could not ratify the variance (${reason}).` },
      { status },
    );
  }
};
