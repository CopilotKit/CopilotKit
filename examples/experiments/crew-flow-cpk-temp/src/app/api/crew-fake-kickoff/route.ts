import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({ id: Math.random().toString(36).substring(2) });
}
