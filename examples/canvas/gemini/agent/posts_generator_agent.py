from google import genai
from google.genai import types
from dotenv import load_dotenv
import os
from langchain_google_genai import ChatGoogleGenerativeAI
from prompts import system_prompt, system_prompt_3, system_prompt_4
load_dotenv()
from typing import Dict, List, Any
from langchain_core.runnables import RunnableConfig
from langgraph.graph import StateGraph, END, START
from copilotkit import CopilotKitState
from copilotkit.langchain import copilotkit_customize_config
from langgraph.types import Command
from langgraph.checkpoint.memory import MemorySaver
from copilotkit.langgraph import copilotkit_emit_state
import uuid
import asyncio

# Define the agent's runtime state schema for CopilotKit/LangGraph
class AgentState(CopilotKitState):
    tool_logs: List[Dict[str, Any]]
    response: Dict[str, Any]


async def chat_node(state: AgentState, config: RunnableConfig):
    # 1. Define the model
    model = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))
    state["tool_logs"].append(
        {
            "id": str(uuid.uuid4()),
            "message": "Analyzing the user's query",
            "status": "processing",
        }
    )
    await copilotkit_emit_state(config, state)

    # 2. Defining a condition to check if the last message is a tool so as to handle the FE tool responses
    if state["messages"][-1].type == "tool":
        client = ChatGoogleGenerativeAI(
            model="gemini-2.5-pro",
            temperature=1.0,
            max_retries=2,
            google_api_key=os.getenv("GOOGLE_API_KEY"),
        )
        messages = [*state["messages"]]
        messages[-1].content = (
            "The posts had been generated successfully. Just generate a summary of the posts."
        )
        resp = await client.ainvoke(
            [*state["messages"]],
            config,
        )
        state["tool_logs"] = []
        await copilotkit_emit_state(config, state)
        return Command(goto="fe_actions_node", update={"messages": resp})

    # 3. Initializing the grounding tool to perform google search when needed. Using the google_search provided in the google.genai.types module
    grounding_tool = types.Tool(google_search=types.GoogleSearch())
    model_config = types.GenerateContentConfig(
        tools=[grounding_tool],
    )
    if config is None:
        config = RunnableConfig(recursion_limit=25)
    else:
        config = copilotkit_customize_config(config, emit_messages=True, emit_tool_calls=True)
    # 4. Generating the response using the model. This returns the response along with the web search queries.
    response = model.models.generate_content(
        model="gemini-2.5-pro",
        contents=[
            types.Content(role="user", parts=[types.Part(text=system_prompt)]),
            types.Content(
                role="model",
                parts=[
                    types.Part(
                        text= system_prompt_4
                    )
                ],
            ),
            types.Content(
                role="user", parts=[types.Part(text=state["messages"][-1].content)]
            ),
        ],
        config=model_config,
    )
    # 5. Updating the tool logs and response so as to see the tool logs in the Frontend Chat UI
    state["tool_logs"][-1]["status"] = "completed"
    await copilotkit_emit_state(config, state)
    state["response"] = response.text
    
    # 6. Orchestrating the web search queries and updating the tool logs
    for query in response.candidates[0].grounding_metadata.web_search_queries:
        state["tool_logs"].append(
            {
                "id": str(uuid.uuid4()),
                "message": f"Performing Web Search for '{query}'",
                "status": "processing",
            }
        )
        await asyncio.sleep(1)
        await copilotkit_emit_state(config, state)
        state["tool_logs"][-1]["status"] = "completed"
        await copilotkit_emit_state(config, state)
    return Command(goto="fe_actions_node", update=state)


async def fe_actions_node(state: AgentState, config: RunnableConfig):
    try:
        if state["messages"][-2].type == "tool":
            return Command(goto="end_node", update=state)
    except Exception as e:
        print("Moved")
        
    state["tool_logs"].append(
        {
            "id": str(uuid.uuid4()),
            "message": "Generating post",
            "status": "processing",
        }
    )
    await copilotkit_emit_state(config, state)
    # 6. Initializing the model to generate the post along with the content that was scraped from the google search previously.
    model = ChatGoogleGenerativeAI(
        model="gemini-2.5-pro",
        temperature=1.0,
        max_retries=2,
        google_api_key=os.getenv("GOOGLE_API_KEY"),
    )
    await copilotkit_emit_state(config, state)
    response = await model.bind_tools([*state["copilotkit"]["actions"]]).ainvoke(
        [system_prompt_3.replace("{context}", state["response"]), *state["messages"]],
        config,
    )
    state["tool_logs"] = []
    await copilotkit_emit_state(config, state)
    # 7. Returning the response to the frontend as a message which will invoke the correct calling of the Frontend useCopilotAction necessary.
    return Command(goto="end_node", update={"messages": response})


async def end_node(state: AgentState, config: RunnableConfig):
    return Command(goto=END, update={"messages": state["messages"], "tool_logs": []})


def router_function(state: AgentState, config: RunnableConfig):
    if state["messages"][-2].role == "tool":
        return "end_node"
    else:
        return "fe_actions_node"


# Define a new graph
workflow = StateGraph(AgentState)
workflow.add_node("chat_node", chat_node)
workflow.add_node("fe_actions_node", fe_actions_node)
workflow.add_node("end_node", end_node)
workflow.set_entry_point("chat_node")
workflow.set_finish_point("end_node")
workflow.add_edge(START, "chat_node")
workflow.add_edge("chat_node", "fe_actions_node")
workflow.add_edge("fe_actions_node", END)


# Compile the graph
post_generation_graph = workflow.compile(checkpointer=MemorySaver())
