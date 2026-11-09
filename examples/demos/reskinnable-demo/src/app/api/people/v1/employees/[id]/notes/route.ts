import type { NextRequest } from "next/server";
import * as store from "@/skins/people/data/store";
import { errorResponse } from "@/skins/people/data/http";

/** BEAT 5, step 3 — the welcome note. The 🎉 prefix is forced by the tool. */
export const POST = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;
    const body = await req.json();
    const text = String(body?.text ?? "").trim();
    if (!text) {
      return Response.json(
        { error: "BAD_REQUEST", message: "A note needs some text." },
        { status: 400 },
      );
    }
    const updated = store.addNote(id, text, String(body?.author ?? "Rowan"));
    return Response.json(updated, { status: 201 });
  } catch (error) {
    return errorResponse(error, "POST employees/[id]/notes");
  }
};
