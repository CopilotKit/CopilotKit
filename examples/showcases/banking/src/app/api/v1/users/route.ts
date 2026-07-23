import type { NextRequest } from "next/server";
import { generateUniqueId } from "../data";
import * as store from "@/lib/store";

export const GET = async () => {
  return new Response(JSON.stringify(store.team()), { status: 200 });
};

export const POST = async (req: NextRequest) => {
  try {
    // Handle new item creation
    const body = await req.json();
    const { name, email, role, team } = body;
    const newUser = { id: generateUniqueId(), name, email, role, team };
    store.addMember(newUser);
    return new Response(JSON.stringify(newUser), { status: 201 });
  } catch (error) {
    console.error("POST Request error", error);
  }
};
