import { NextResponse } from "next/server";
import { testData } from "@/lib/testData";
export const POST = async () => {
    return NextResponse.json(testData);
}
