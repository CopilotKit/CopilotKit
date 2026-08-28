from __future__ import annotations

import os

from ag_ui_adk import ADKAgent, AGUIToolset, add_adk_fastapi_endpoint
from dotenv import load_dotenv
from fastapi import FastAPI
from google.adk.agents import LlmAgent
from google.adk.tools import google_search
from google.adk.tools.agent_tool import AgentTool

load_dotenv()


search_agent = LlmAgent(
    name="SearchAgent",
    model="gemini-3.7-flash",
    description="Searches the live web for a grounded three-market snapshot.",
    instruction="""
        Use Google Search for the user's current market-data request. Return a
        concise headline and summary plus exactly three closely related market
        rows. Each row must contain a display name, current price with units,
        latest percentage or absolute change, source publisher, and canonical
        absolute source URL. Also return why the combined movement matters and
        the current UTC search time in ISO 8601 format. Never invent a value,
        source, URL, or timestamp.
    """,
    tools=[google_search],
)


market_agent = LlmAgent(
    name="MarketAgent",
    model="gemini-3.7-flash",
    instruction="""
        For a current market-data request, delegate the research to SearchAgent.
        Then call the available interactive UI tool exactly once with the
        grounded result. Do not substitute a prose-only response; after the UI
        tool call, use at most one short sentence. The UI tool schema is the
        complete presentation contract, so do not invent fields or component
        names. If the user reports the action acknowledge_search_result, confirm
        it briefly without searching or rendering another interface.
    """,
    tools=[AgentTool(agent=search_agent), AGUIToolset()],
)


adk_market_agent = ADKAgent(
    adk_agent=market_agent,
    user_id="channels_a2ui_demo",
    session_timeout_seconds=3600,
    use_in_memory_services=True,
)

app = FastAPI(title="Channels A2UI Market Agent")
add_adk_fastapi_endpoint(app, adk_market_agent, path="/")


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    if not os.getenv("GOOGLE_API_KEY"):
        print("Warning: GOOGLE_API_KEY is not set")
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8000)))
