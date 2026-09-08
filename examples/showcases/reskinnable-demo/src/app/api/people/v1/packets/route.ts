import type { NextRequest } from "next/server";
import * as store from "@/skins/people/data/store";
import { errorResponse } from "@/skins/people/data/http";

/**
 * BEAT 3d — the durable artifact.
 *
 * An onboarding packet is written to the STORE, so it belongs to the
 * application and not to the conversation that produced it. That is the whole
 * point of the beat: delete the thread, reload the browser, and the packet is
 * still sitting on the Onboarding page. Nothing here references a thread id.
 */
export const GET = async () => Response.json(store.packets());

export const POST = async (req: NextRequest) => {
  try {
    const body = await req.json();
    const employeeId = String(body?.employeeId ?? "");
    const summary = String(body?.summary ?? "").trim();
    if (!employeeId || !summary) {
      return Response.json(
        {
          error: "BAD_REQUEST",
          message: "A packet needs an employeeId and a summary.",
        },
        { status: 400 },
      );
    }
    // Sanitize the model-authored arrays rather than trusting their shape: the
    // agent fills these from an uploaded PDF, so a malformed row is a normal
    // outcome, not an exceptional one.
    const highlights = Array.isArray(body?.highlights)
      ? body.highlights
          .map((h: unknown) => String(h))
          .filter(Boolean)
          .slice(0, 3)
      : [];
    const schedule = Array.isArray(body?.schedule)
      ? body.schedule
          .map((s: { day?: unknown; item?: unknown }) => ({
            day: String(s?.day ?? "").trim(),
            item: String(s?.item ?? "").trim(),
          }))
          .filter((s: { day: string; item: string }) => s.day && s.item)
          .slice(0, 8)
      : [];

    const packet = store.filePacket({
      employeeId,
      summary,
      highlights,
      schedule,
      filedBy: String(body?.filedBy ?? "Rowan"),
    });
    return Response.json(packet, { status: 201 });
  } catch (error) {
    return errorResponse(error, "POST packets");
  }
};
