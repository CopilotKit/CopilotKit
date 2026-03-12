import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { canvas_state, sheet_id } = body;

    if (!canvas_state) {
      return NextResponse.json(
        { error: "Canvas state is required" },
        { status: 400 }
      );
    }

    if (!sheet_id) {
      return NextResponse.json(
        { error: "Sheet ID is required" },
        { status: 400 }
      );
    }

    // Make request to Python agent's sync endpoint
    const agentUrl = process.env.AGENT_URL || 'http://localhost:9000';
    const response = await fetch(`${agentUrl}/sync-to-sheets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        canvas_state,
        sheet_id,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Agent sync failed:', errorText);
      return NextResponse.json(
        { error: "Failed to sync with Google Sheets", details: errorText },
        { status: 500 }
      );
    }

    const result = await response.json();
    return NextResponse.json(result);

  } catch (error) {
    console.error('Sync error:', error);
    return NextResponse.json(
      { error: "Internal server error during sync" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ message: "Sheets sync API endpoint" });
}