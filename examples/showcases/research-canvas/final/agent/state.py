from langchain_core.messages import AnyMessage
from langgraph.graph import add_messages
from typing import TypedDict, Dict, Union, List, Annotated
from copilotkit import CopilotKitState # extends MessagesState

class ResearchState(CopilotKitState):
    title: str
    proposal: Dict[str, Union[str, bool, Dict[str, Union[str, bool]]]]  # Stores proposed structure before user approval
    outline: dict
    sections: List[dict]  # list of dicts with 'title','content',and 'idx'
    footnotes: str
    sources: Dict[str, Dict[str, Union[str, float]]]
    tool: str
    logs: List[dict]  # list of dicts logs to be sent to frontend with 'message', 'status'


