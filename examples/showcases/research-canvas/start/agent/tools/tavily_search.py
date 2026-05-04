import asyncio
from copilotkit.langchain import copilotkit_emit_state
from datetime import datetime
from dotenv import load_dotenv
import json
from langchain_core.tools import tool
from pydantic import BaseModel, Field
from tavily import AsyncTavilyClient
from typing import List, Dict, Optional
from langchain_core.runnables import RunnableConfig
load_dotenv('.env')
tavily_client = AsyncTavilyClient()

# Add Tavily's arguments to enhance the web search tool's capabilities
class TavilyQuery(BaseModel):
    query: str = Field(description="Web search query")
    topic: str = Field(
        description="Type of search, MUST be 'general' or 'news'. Choose 'news' ONLY when the company you searching is publicly traded and is likely to be featured on popular news")
    days: int = Field(description="Number of days back to run 'news' search")
    domains: Optional[List[str]] = Field(default=None,
                                         description="List of domains to include in the research. Useful when trying to gather information from trusted and relevant domains")


# Define the args_schema for the tavily_search tool using a multi-query approach, enabling more precise queries for Tavily.
class TavilySearchInput(BaseModel):
    sub_queries: List[TavilyQuery] = Field(description="Set of sub-queries that can be answered in isolation")
    state: Optional[Dict] = Field(description="State of the research, will be provided later")


@tool("tavily_search", args_schema=TavilySearchInput, return_direct=True)
async def tavily_search(sub_queries: List[TavilyQuery], state):
    """Perform searches for each sub-query using the Tavily search tool concurrently."""
    # Define a coroutine function to perform a single search with error handling
    async def perform_search(itm, index):
        try:
            # Add date to the query as we need the most recent results
            query_with_date = f"{itm.query} {datetime.now().strftime('%m-%Y')}"
            # state["logs"][index]["message"] = f"🌐 Searched: '{query.query}'",
            topic = itm.topic if itm.topic in ['general','news'] else "general"
            tavily_response = await tavily_client.search(query=query_with_date, topic=topic, days=itm.days, max_results=10)
            state["logs"][index]["done"] = True
            tavily_response['results'] = [search for search in tavily_response['results'] if search['score'] > 0.45]
            await copilotkit_emit_state(config, state)
            return tavily_response['results']
        except Exception as e:
            # Handle any exceptions, log them, and return an empty list
            print(f"Error occurred during search for query '{itm.query}': {str(e)}")
            state["logs"][index]["done"] = True
            await copilotkit_emit_state(config, state)
            return []

    config = RunnableConfig()
    state["logs"] = state.get("logs", [])
    # Log search queries
    for query in sub_queries:
        state["logs"].append({
            "message": f"🌐 Searching the web: '{query.query}'",
            "done": False
        })
    await copilotkit_emit_state(config, state)

    # Run all the search tasks in parallel
    search_tasks = [perform_search(query, i) for i, query in enumerate(sub_queries)]
    search_responses = await asyncio.gather(*search_tasks)


    # Combine the results from all the responses
    tool_msg = "In search, found the following new documents:\n"
    sources = state.get('sources', {})
    for i, response in enumerate(search_responses):
        for source in response:
            if not sources or source['url'] not in sources:
                sources[source['url']] = source
                tool_msg += json.dumps(source)

        state["logs"][i]["done"] = True
        await copilotkit_emit_state(config, state)

    for key,val in sources.items():
        if not sources[key].get('title',None):
            sources[key]['title'] = 'No Title, Invalid Link'


    state['sources'] = sources

    return state, tool_msg
