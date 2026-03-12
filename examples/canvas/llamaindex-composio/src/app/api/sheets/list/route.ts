import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sheet_id } = body;

    if (!sheet_id) {
      return NextResponse.json(
        { error: "Sheet ID is required" },
        { status: 400 }
      );
    }

    // Make request to Python agent to list sheet names
    const agentUrl = process.env.AGENT_URL || 'http://localhost:9000';
    const response = await fetch(`${agentUrl}/sheets/list`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sheet_id: sheet_id,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Agent list failed:', errorText);
      return NextResponse.json(
        { error: "Failed to list sheets", details: errorText },
        { status: 500 }
      );
    }

    const result = await response.json();
    return NextResponse.json(result);

  } catch (error) {
    console.error('List error:', error);
    return NextResponse.json(
      { error: "Internal server error during sheet listing" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ message: "Sheets list API endpoint" });
}