"""
Tools
"""
import os
from typing_extensions import Dict, Any, List, cast
from tavily import TavilyClient
from copilotkit.crewai import copilotkit_emit_state
from litellm import completion

HITL_TOOLS = ["DeleteResources"]

tavily_client = TavilyClient(api_key=os.getenv("TAVILY_API_KEY"))

async def perform_tool_calls(state: Dict[str, Any]):
    """
    Perform tool calls on the state.
    """
    if len(state["messages"]) == 0:
        return False
    message = state["messages"][-1]

    if not message["tool_calls"]:
        return False

    tool_call = message["tool_calls"][0]

    if tool_call["name"] in HITL_TOOLS:
        return False

    if tool_call["name"] == "Search":
        queries = tool_call["arguments"].get("queries", [])
        await perform_search(state, queries, tool_call["id"])

    elif tool_call["name"] == "WriteReport":
        state["report"] = tool_call["arguments"].get("report", "")
        state["messages"].append({
            "role": "tool",
            "content": "Report written.",
            "tool_call_id": tool_call["id"]
        })

    elif tool_call["name"] == "WriteResearchQuestion":
        state["research_question"] = tool_call["arguments"].get("research_question", "")
        state["messages"].append({
            "role": "tool",
            "content": "Research question written.",
            "tool_call_id": tool_call["id"]
        })
    return True

async def perform_search(state: Dict[str, Any], queries: List[str], tool_call_id: str):
    """
    Perform a search.
    """
    state["resources"] = state.get("resources", [])
    state["logs"] = state.get("logs", [])

    for query in queries:
        state["logs"].append({
            "message": f"Search for {query}",
            "done": False
        })

    await copilotkit_emit_state(state)

    search_results = []

    for i, query in enumerate(queries):
        response = tavily_client.search(query)
        search_results.append(response)
        state["logs"][i]["done"] = True
        await copilotkit_emit_state(state)
    
    response = completion(
            model="openai/gpt-4o",
            messages=[
                {
                    "role": "system", 
                    "content": "You need to extract the 3-5 most relevant resources from the following search results."
                },
                *state["messages"],
                {
                    "role": "tool",
                    "content": f"Performed search: {search_results}",
                    "tool_call_id": tool_call_id
                }
            ],
            tools=[EXTRACT_RESOURCES_TOOL],
            tool_choice="ExtractResources",
            parallel_tool_calls=False
        )

    state["logs"] = []
    await copilotkit_emit_state(state)

    message = cast(Any, response).choices[0]["message"]
    resources = message["tool_calls"][0]["args"]["resources"]

    state["resources"].extend(resources)

    state["messages"].append({
        "role": "tool",
        "content": f"Added the following resources: {resources}",
        "tool_call_id": tool_call_id
    })

EXTRACT_RESOURCES_TOOL = {
    "type": "function",
    "function": {
        "name": "ExtractResources",
        "description": "Extract the 3-5 most relevant resources from a search result.",
        "parameters": {
            "type": "object",
            "resources": {
                "type": "array",
                "items": {
                    "type": "object",
                    "url": {
                        "type": "string",
                        "description": "The URL of the resource"
                    },
                    "title": {
                        "type": "string",
                        "description": "The title of the resource"
                    },
                    "description": {
                        "type": "string",
                        "description": "A short description of the resource"
                    }
                },
                "description": "The list of resources"
            },
        },
        "required": ["resources"],
    },
}


SEARCH_TOOL = {
    "type": "function",
    "function": {
        "name": "Search",
        "description": "Provide a list of one or more search queries to find good resources for the research.",
        "parameters": {
            "type": "object",
            "queries": {
                "type": "array",
                "items": {
                    "type": "string"
                },
                "description": "The list of search queries",
            },
        },
        "required": ["queries"],
    },
}

WRITE_REPORT_TOOL = {
    "type": "function",
    "function": {
        "name": "WriteReport",
        "description": "Write the research report.",
        "parameters": {
            "type": "string",
            "report": "The research report.",
        },
    },
}

WRITE_RESEARCH_QUESTION_TOOL = {
    "type": "function",
    "function": {
        "name": "WriteResearchQuestion",
        "description": "Write the research question.",
        "parameters": {
            "type": "string",
            "research_question": "The research question.",
        },
    },
}

DELETE_RESOURCES_TOOL = {
    "type": "function",
    "function": {
        "name": "DeleteResources",
        "description": "Delete the URLs from the resources.",
        "parameters": {
            "type": "array",
            "urls": "The URLs to delete.",
        },
    },
}
