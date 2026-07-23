import type { NextRequest } from "next/server";
import * as store from "@/lib/store";

export const PUT = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;
    // Handle role/team change
    const body = await req.json();
    const { team, role } = body;
    const updated = store.updateMember(id, { team, role });
    if (!updated) {
      return new Response(JSON.stringify({ error: "User not found" }), {
        status: 404,
      });
    }
    return new Response(JSON.stringify(updated), { status: 200 });
  } catch (error) {
    console.error("PUT Request error", error);
  }
};

export const DELETE = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;
    const remaining = store.removeMember(id);
    if (!remaining) {
      return new Response(JSON.stringify({ error: "User not found" }), {
        status: 404,
      });
    }
    return new Response(JSON.stringify(remaining), { status: 200 });
  } catch (error) {
    console.error("DELETE Request error", error);
  }
};
