#!/usr/bin/env python
from datetime import datetime
from typing import Optional, List, Dict
from crewai.utilities.events import crewai_event_bus
from crewai.utilities.events.base_events import BaseEvent

# ==================== EVENTS ====================
class CopilotKitPredictStateEvent(BaseEvent):
    """Predict state event"""
    type: str = "copilotkit_predict_state"
    predict_config: List[Dict[str, str]] = []
    context: str = ""
    timestamp: Optional[datetime] = None


# ==================== PREDICT STATE HANDLER ====================

def emit_copilotkit_predict_state(
    predict_config: List[Dict[str, str]],
    context: str = "predict_state"
):
    """
    Fire CopilotKit predict state event immediately.

    Usage:
        copilotkit_predict_state([{
            "state_key": "recipe",
            "tool": "generate_recipe",
            "tool_argument": "recipe"
        }])
    """
    event = CopilotKitPredictStateEvent(
        predict_config=predict_config,
        context=context,
        timestamp=datetime.now()
    )

    crewai_event_bus.emit(source="copilotkit_predict_state", event=event)

    print(f"🔮 PREDICT STATE [{context}]: {len(predict_config)} states")
    for config in predict_config:
        print(f"   → {config['state_key']}: {config['tool']}({config['tool_argument']})")
