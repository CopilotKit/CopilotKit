#!/usr/bin/env python
import json
import threading
from datetime import datetime
from typing import Optional, List, Dict, Any
from collections import defaultdict
from litellm import completion
from crewai.utilities.events import crewai_event_bus
from crewai.utilities.events.base_events import BaseEvent


# ==================== EVENTS ====================

class DebouncedLLMStreamChunkEvent(BaseEvent):
    """Simple debounced chunk event"""
    type: str = "debounced_llm_stream_chunk"
    chunk: str = ""
    context: str = ""
    sequence: int = 0
    timestamp: Optional[datetime] = None


# ==================== DEBOUNCER ====================

class Debouncer:
    """Debouncer - accumulate chunks for specified delay then emit"""

    def __init__(self, delay_ms=100):
        self.delay = delay_ms / 1000.0
        self.accumulated = ""
        self.context = "thinking"
        self.timer = None
        self.sequence = 0

    def add_chunk(self, content: str, context: str = "thinking"):
        """Add content and start/reset timer"""
        self.accumulated += content
        self.context = context

        if self.timer:
            self.timer.cancel()

        self.timer = threading.Timer(self.delay, self._emit)
        self.timer.start()

        # Emit immediately if we've accumulated enough content
        if len(self.accumulated) >= 30:
            self._emit_now()

    def _emit_now(self):
        """Emit immediately"""
        if self.timer:
            self.timer.cancel()
        self._emit()

    def _emit(self):
        """Emit the accumulated content"""
        if not self.accumulated:
            return

        event = DebouncedLLMStreamChunkEvent(
            chunk=self.accumulated,
            context=self.context,
            sequence=self.sequence,
            timestamp=datetime.now()
        )

        crewai_event_bus.emit(source="llm_stream_handler", event=event)

        # Reset
        self.accumulated = ""
        self.timer = None
        self.sequence += 1

    def flush(self):
        """Force emit any remaining content"""
        self._emit_now()


# ==================== STREAM HANDLER ====================

class LLMStreamResponse:
    """Clean response object with content and tool calls"""

    def __init__(self, content: str = "", tool_calls: List[Dict[str, Any]] = None):
        self.content = content
        self.tool_calls = tool_calls or []

    def has_tool_calls(self) -> bool:
        return len(self.tool_calls) > 0


class LLMStreamHandler:
    """Handles LLM streaming with debounced chunking and clean tool call extraction"""

    def __init__(self, delay_ms: int = 100):
        self.debouncer = Debouncer(delay_ms)

    def stream_completion(
        self,
        model: str,
        messages: List[Dict[str, Any]],
        tools: List[Dict[str, Any]] = None,
        **kwargs
    ) -> LLMStreamResponse:
        """
        Stream completion with automatic chunking and tool call handling.
        Returns a clean LLMStreamResponse with content and properly formatted tool_calls.
        """
        try:
            response_stream = completion(
                model=model,
                messages=messages,
                tools=tools,
                parallel_tool_calls=False,
                stream=True,
                **kwargs
            )

            full_content = ""
            accumulated_tool_args = defaultdict(lambda: {
                'id': None,
                'type': 'function',
                'function': {'name': None, 'arguments': ''}
            })
            current_context = "thinking"

            for chunk in response_stream:
                if hasattr(chunk, 'choices') and chunk.choices:
                    delta = chunk.choices[0].delta

                    # Handle regular content
                    if hasattr(delta, 'content') and delta.content:
                        full_content += delta.content
                        self.debouncer.add_chunk(delta.content, current_context)

                    # Handle tool calls
                    if hasattr(delta, 'tool_calls') and delta.tool_calls:
                        current_context = "tool_calling"

                        for tool_call in delta.tool_calls:
                            index = tool_call.index
                            current_tool = accumulated_tool_args[index]

                            # Set tool call ID if available
                            if hasattr(tool_call, 'id') and tool_call.id:
                                current_tool['id'] = tool_call.id

                            if hasattr(tool_call, 'function'):
                                if hasattr(tool_call.function, 'name') and tool_call.function.name:
                                    current_tool['function']['name'] = tool_call.function.name

                                if hasattr(tool_call.function, 'arguments') and tool_call.function.arguments:
                                    current_tool['function']['arguments'] += tool_call.function.arguments
                                    self.debouncer.add_chunk(
                                        tool_call.function.arguments,
                                        current_tool['function']['name']
                                    )

            # Flush any remaining content
            self.debouncer.flush()

            # Format tool calls properly
            tool_calls = []
            for tool_data in accumulated_tool_args.values():
                if tool_data['function']['name']:
                    # Parse arguments to ensure they're valid JSON
                    try:
                        parsed_args = json.loads(tool_data['function']['arguments'])
                        tool_calls.append({
                            'id': tool_data['id'],
                            'type': tool_data['type'],
                            'function': {
                                'name': tool_data['function']['name'],
                                'arguments': parsed_args
                            }
                        })
                    except json.JSONDecodeError as e:
                        print(f"Warning: Invalid JSON in tool arguments: {e}")
                        continue

            return LLMStreamResponse(content=full_content, tool_calls=tool_calls)

        except Exception as e:
            self.debouncer.flush()  # Flush on error
            raise e


# ==================== CONVENIENCE FUNCTIONS ====================

def copilotkit_stream_completion(
    model: str,
    messages: List[Dict[str, Any]],
    tools: List[Dict[str, Any]] = None,
    delay_ms: int = 100,
    **kwargs
) -> LLMStreamResponse:
    """
    CopilotKit streaming completion with automatic chunking and tool handling.

    Usage:
        response = copilotkit_stream_completion(
            model="gpt-4o",
            messages=[{"role": "user", "content": "Hello"}],
            tools=[SOME_TOOL]
        )

        print(response.content)
        for tool_call in response.tool_calls:
            # Clean, parsed tool calls ready to use
            pass
    """
    handler = LLMStreamHandler(delay_ms)
    return handler.stream_completion(model, messages, tools, **kwargs)


# ==================== EVENT HANDLER SETUP ====================

@crewai_event_bus.on(DebouncedLLMStreamChunkEvent)
def handle_debounced_chunk(source, event: DebouncedLLMStreamChunkEvent):
    """Default handler for debounced chunk events"""
    chunk_preview = event.chunk[:80] + "..." if len(event.chunk) > 80 else event.chunk
    print(f"🔥 CHUNK #{event.sequence} [{event.context}]: '{chunk_preview}' (len: {len(event.chunk)})")