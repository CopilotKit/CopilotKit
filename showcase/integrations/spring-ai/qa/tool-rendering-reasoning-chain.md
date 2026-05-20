# QA: Tool Rendering (Reasoning Chain) — Spring AI

## Prerequisites

- Spring AI backend is up with `get_weather` and `search_flights` tools

## Test Steps

- [ ] Navigate to `/demos/tool-rendering-reasoning-chain`
- [ ] Send: "Check weather in Tokyo, then search for flights SFO to JFK"
- [ ] Verify WeatherCard renders for the weather tool call
- [ ] Verify FlightListCard renders for the search_flights tool call
- [ ] If the adapter emits reasoning events, verify the ReasoningBlock renders between tool calls

## Expected Results

- Per-tool custom renderers fire for `get_weather` and `search_flights`
- Catchall renderer handles any unexpected tools
- Reasoning slot renders when backend provides reasoning content
