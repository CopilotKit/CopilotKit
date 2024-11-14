import json
from todo_manager.state import AgentState
from todo_manager.todos import add_todos, update_todos, delete_todos
from langchain_core.messages import SystemMessage
from langchain_openai import ChatOpenAI
from langchain_community.tools.tavily_search.tool import TavilySearchResults

llm = ChatOpenAI(model="gpt-4o")
tools = [TavilySearchResults(max_results=5)]

def chat_node(state: AgentState):
    """Handle chat operations"""
    llm_with_tools = llm.bind_tools([
        *tools,
        add_todos,
        update_todos,
        delete_todos,
    ])

    return {
        "messages": [
            llm_with_tools.invoke([
                SystemMessage(
                content=f"You are an todo manager agent. You are helping the user with their todos. Current todos: {json.dumps(state.get('todos', []))}"
            ),*state["messages"]])
        ],
    }