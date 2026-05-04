from langchain_core.tools import tool
from pydantic import BaseModel, Field
from tavily import AsyncTavilyClient
from typing import List, Optional, Dict
from copilotkit.langchain import copilotkit_emit_state
from langchain_core.runnables import RunnableConfig

tavily_client = AsyncTavilyClient()


class TavilyExtractInput(BaseModel):
    urls: List[str] = Field(description="List of a single or several URLs for extracting raw content to gather additional information")
    state: Optional[Dict] = Field(description="State of the research")


@tool("tavily_extract", args_schema=TavilyExtractInput, return_direct=True)
async def tavily_extract(urls, state):
    """Perform full scrape to a provided list of urls."""

    try:
        response = await tavily_client.extract(urls=urls)
        results = response['results']
        # Match and add raw_content to urls in state
        tool_msg = "Extracted raw content to gather additional information from the following sources:\n"
        for itm in results:
            url = itm['url']
            raw_content = itm['raw_content']
            if url in state["sources"]:
                state["sources"][url]['raw_content'] = raw_content
            else:
                state["sources"][url] = {'raw_content': raw_content}
            tool_msg += f"{url}\n"

        config = RunnableConfig()
        state["logs"] = state.get("logs", [])
        state["logs"].append({
            "message": "🚀 Extracting additional content from valuable sources",
            "done": True
        })
        await copilotkit_emit_state(config, state)
        return state, tool_msg

    except Exception as e:
        print(f"Error occurred during extract: {str(e)}")
        return state, ""

