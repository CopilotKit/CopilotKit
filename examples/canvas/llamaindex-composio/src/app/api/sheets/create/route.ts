import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title } = body;

    if (!title || typeof title !== 'string' || title.trim() === '') {
      return NextResponse.json(
        { error: "Sheet title is required and must be a non-empty string" },
        { status: 400 }
      );
    }

    // Make request to Python agent to create new sheet
    const agentUrl = process.env.AGENT_URL || 'http://localhost:9000';
    const response = await fetch(`${agentUrl}/sheets/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: title.trim(),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Agent create failed:', errorText);
      return NextResponse.json(
        { error: "Failed to create sheet", details: errorText },
        { status: 500 }
      );
    }

    const result = await response.json();
    return NextResponse.json(result);

  } catch (error) {
    console.error('Create error:', error);
    return NextResponse.json(
      { error: "Internal server error during sheet creation" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ message: "Sheets create API endpoint" });
}