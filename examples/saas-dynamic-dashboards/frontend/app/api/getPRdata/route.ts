import { NextResponse } from "next/server";
import { prData } from "@/lib/data";
export const POST = async () => {
    return NextResponse.json(prData);
}
