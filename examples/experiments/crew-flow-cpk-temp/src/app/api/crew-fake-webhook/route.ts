import { NextResponse } from "next/server";
const events = [
  {
    type: "crew_kickoff_started",
    crew_id: Math.random().toString(36).substring(2),
    timestamp: Date.now(),
    data: {
      crew_name: "Book Writing Crew",
      status: "starting",
    },
  },
  {
    type: "crew_step_started",
    step_id: Math.random().toString(36).substring(2),
    timestamp: Date.now(),
    data: {
      step_name: "Research Phase",
      status: "in_progress",
    },
  },
  {
    type: "llm_call_started",
    call_id: Math.random().toString(36).substring(2),
    timestamp: Date.now(),
    data: {
      model: "gpt-4",
      prompt: "Research book topic: AI Ethics",
    },
  },
  {
    type: "llm_call_completed",
    call_id: Math.random().toString(36).substring(2),
    timestamp: Date.now(),
    data: {
      model: "gpt-4",
      response: "Research completed successfully",
    },
  },
  {
    type: "tool_usage_started",
    tool_id: Math.random().toString(36).substring(2),
    timestamp: Date.now(),
    data: {
      tool_name: "web_search",
      parameters: { query: "AI Ethics latest developments" },
    },
  },
  {
    type: "tool_usage_completed",
    tool_id: Math.random().toString(36).substring(2),
    timestamp: Date.now(),
    data: {
      tool_name: "web_search",
      result: "Search results retrieved",
    },
  },
  {
    type: "crew_step_completed",
    step_id: Math.random().toString(36).substring(2),
    timestamp: Date.now(),
    data: {
      step_name: "Research Phase",
      status: "completed",
      result: "Research phase completed successfully",
    },
  },
  {
    type: "crew_execution_completed",
    crew_id: Math.random().toString(36).substring(2),
    timestamp: Date.now(),
    data: {
      crew_name: "Book Writing Crew",
      status: "completed",
      result: "All tasks completed successfully",
    },
  },
];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "crew_kickoff_started";
  const eventIndex = events.findIndex((e) => e.type === type);
  const nextEvent = events[eventIndex + 1] || events[0];
  return NextResponse.json(nextEvent);
}
