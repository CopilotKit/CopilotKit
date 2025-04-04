import { NextResponse } from "next/server";

export async function GET() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let count = 0;

      // Send an event every 2 seconds
      const interval = setInterval(() => {
        const event = `data: ${JSON.stringify({
          count,
          timestamp: new Date().toISOString(),
        })}\n\n`;
        controller.enqueue(encoder.encode(event));
        count++;

        // Stop after 10 events
        if (count >= 10) {
          clearInterval(interval);
          controller.close();
        }
      }, 2000);
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
