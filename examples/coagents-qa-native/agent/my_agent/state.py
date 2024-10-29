"""
This is the state definition for the AI.
It defines the state of the agent and the state of the conversation.
"""

from langgraph.graph import MessagesState

class EmailAgentState(MessagesState):
    """Email Agent State"""
    email: str
    model: str = "openai"
