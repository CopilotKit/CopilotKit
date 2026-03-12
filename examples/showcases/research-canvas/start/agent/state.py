from typing import Dict, Union, List
from langgraph.graph import MessagesState

class ResearchState(MessagesState):
    title: str
    proposal: Dict[str, Union[str, bool, Dict[str, Union[str, bool]]]]  # Stores proposed structure before user approval
    outline: dict
    sections: List[dict]  # list of dicts with 'title','content',and 'idx'
    footnotes: str
    sources: Dict[str, Dict[str, Union[str, float]]]
    tool: str
    logs: List[dict]  # list of dicts logs to be sent to frontend with 'message', 'status'


