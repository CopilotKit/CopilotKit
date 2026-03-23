"""
UIGeneratorAgent - A2A agent with A2UI support for dynamic UI generation.

This agent uses LangGraph with LangChain ChatOpenAI to generate A2UI declarative JSON
responses that render rich, interactive UIs for any user request.
"""

import json
import logging
import os
from collections.abc import AsyncIterable, Sequence
from typing import Any

import jsonschema
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, MessagesState, StateGraph

from .prompt_builder import (
    A2UI_SCHEMA,
    UI_EXAMPLES,
    get_text_prompt,
    get_ui_prompt,
)

logger = logging.getLogger(__name__)


def _build_chat_llm() -> ChatOpenAI:
    """
    Chat model for the UI generator.
    """
    qwen_model = os.getenv("QWEN_MODEL", "qwen3.5-plus")
    return ChatOpenAI(
        model=qwen_model,
        base_url=os.getenv(
            "DASHSCOPE_BASE_URL",
            "https://dashscope.aliyuncs.com/compatible-mode/v1",
        ),
        api_key=os.getenv("DASHSCOPE_API_KEY"),
    )


def _message_content_to_str(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, dict) and "text" in block:
                parts.append(str(block["text"]))
            elif isinstance(block, str):
                parts.append(block)
        return "".join(parts)
    return str(content)


# Agent instruction for general-purpose UI generation
AGENT_INSTRUCTION = """
You are a UI generation assistant. You create any user interface using A2UI declarative JSON.

**Your capabilities:**
- Forms: Contact forms, signup forms, surveys, settings panels, feedback forms
- Dropdowns: Use **MultipleChoice** with maxAllowedSelections 1 (see DROPDOWN_EXAMPLE) for country, role, category, etc.
- Lists: Todo lists, shopping lists, search results, notifications, item catalogs
- Cards: Profile cards, product cards, info cards, stats cards, notification cards
- Confirmations: Success messages, error alerts, booking confirmations, status updates

**How to generate UI:**
1. Listen to what UI the user wants
2. Choose the appropriate template as your starting pattern:
   - For forms: Use FORM_EXAMPLE
   - For dropdown / select fields: Use DROPDOWN_EXAMPLE (MultipleChoice)
   - For lists: Use LIST_EXAMPLE
   - For cards: Use CARD_EXAMPLE
   - For confirmations: Use CONFIRMATION_EXAMPLE
3. Modify the template based on user requirements:
   - Add or remove fields/items
   - Change labels and text
   - Adjust layouts (Row for horizontal, Column for vertical)
4. Generate valid A2UI JSON

**Dynamic UI generation:**
- Templates are examples, not strict rules - modify them freely
- Add any fields the user requests
- Change layouts, colors, and structure as needed
- The A2UI JSON schema is your only hard constraint

**Examples of requests you can handle:**
- "Create a contact form with name, email, and message fields"
- "Show me a todo list with 5 items"
- "Make a profile card for John Doe"
- "Generate a success confirmation message"
- "Build a settings panel with toggles and dropdowns"
- "Create a shopping list with checkboxes"
"""


class UIGeneratorAgent:
    """An agent that generates any UI using A2UI declarative JSON."""

    SUPPORTED_CONTENT_TYPES = ["text", "text/plain"]

    def __init__(self, base_url: str, use_ui: bool = True):
        """
        Initialize the UIGeneratorAgent.

        Args:
            base_url: Base URL for resolving static assets (not used currently).
            use_ui: Whether to generate A2UI responses (True) or text-only (False).
        """
        self.base_url = base_url
        self.use_ui = use_ui
        # Lazy: ChatOpenAI validates OPENAI_API_KEY at construction time
        self._llm: ChatOpenAI | None = None
        if use_ui:
            self._system_instruction = (
                AGENT_INSTRUCTION + get_ui_prompt(self.base_url, UI_EXAMPLES)
            )
        else:
            self._system_instruction = get_text_prompt()
        self._graph = self._compile_graph()

        try:
            single_message_schema = json.loads(A2UI_SCHEMA)
            self.a2ui_schema_object = {"type": "array", "items": single_message_schema}
            logger.info("A2UI_SCHEMA successfully loaded for validation.")
        except json.JSONDecodeError as e:
            logger.error(f"CRITICAL: Failed to parse A2UI_SCHEMA: {e}")
            self.a2ui_schema_object = None

    def get_processing_message(self) -> str:
        """Returns a message to show while processing."""
        return "Generating your UI..."

    def _compile_graph(self):
        """Single-node LangGraph with message history + MemorySaver per thread."""

        system_instruction = self._system_instruction
        agent = self

        async def generate_node(state: MessagesState) -> dict[str, Sequence[BaseMessage]]:
            if agent._llm is None:
                agent._llm = _build_chat_llm()
            sys_msg = SystemMessage(content=system_instruction)
            messages: list[BaseMessage] = [sys_msg, *state["messages"]]
            response: AIMessage = await agent._llm.ainvoke(messages)
            return {"messages": [response]}

        workflow = StateGraph(MessagesState)
        workflow.add_node("generate", generate_node)
        workflow.add_edge(START, "generate")
        workflow.add_edge("generate", END)
        return workflow.compile(checkpointer=MemorySaver())

    async def stream(self, query: str, session_id: str) -> AsyncIterable[dict[str, Any]]:
        """
        Stream agent responses for a query.

        Args:
            query: The user's query text.
            session_id: Session identifier for conversation continuity (LangGraph thread).

        Yields:
            Dict containing response content and completion status.
        """
        max_retries = 1
        attempt = 0
        current_query_text = query

        if self.use_ui and self.a2ui_schema_object is None:
            logger.error("A2UI_SCHEMA is not loaded. Cannot validate UI responses.")
            yield {
                "is_task_complete": True,
                "content": (
                    "I'm sorry, I'm facing an internal configuration error. "
                    "Please contact support."
                ),
            }
            return

        config = {"configurable": {"thread_id": session_id}}

        while attempt <= max_retries:
            attempt += 1
            logger.info(
                f"UIGeneratorAgent.stream: Attempt {attempt}/{max_retries + 1} "
                f"for session {session_id}"
            )

            yield {
                "is_task_complete": False,
                "updates": self.get_processing_message(),
            }

            result = await self._graph.ainvoke(
                {"messages": [HumanMessage(content=current_query_text)]},
                config,
            )

            final_messages = result.get("messages") or []
            final_response_content: str | None = None
            if final_messages:
                last = final_messages[-1]
                if isinstance(last, AIMessage):
                    final_response_content = _message_content_to_str(last.content)

            if not final_response_content or not final_response_content.strip():
                logger.warning(
                    f"No final response content from graph (Attempt {attempt})."
                )
                if attempt <= max_retries:
                    current_query_text = (
                        f"I received no response. Please retry: '{query}'"
                    )
                    continue
                final_response_content = (
                    "I'm sorry, I encountered an error processing your request."
                )

            is_valid = False
            error_message = ""

            if self.use_ui:
                logger.info(f"Validating UI response (Attempt {attempt})...")
                try:
                    if "---a2ui_JSON---" not in final_response_content:
                        raise ValueError("Delimiter '---a2ui_JSON---' not found.")

                    _text_part, json_string = final_response_content.split(
                        "---a2ui_JSON---", 1
                    )

                    if not json_string.strip():
                        raise ValueError("JSON part is empty.")

                    json_string_cleaned = (
                        json_string.strip().lstrip("```json").rstrip("```").strip()
                    )

                    if not json_string_cleaned:
                        raise ValueError("Cleaned JSON string is empty.")

                    parsed_json_data = json.loads(json_string_cleaned)
                    jsonschema.validate(
                        instance=parsed_json_data, schema=self.a2ui_schema_object
                    )

                    logger.info(f"UI JSON validated successfully (Attempt {attempt}).")
                    is_valid = True

                except (
                    ValueError,
                    json.JSONDecodeError,
                    jsonschema.exceptions.ValidationError,
                ) as e:
                    logger.warning(f"A2UI validation failed: {e} (Attempt {attempt})")
                    error_message = f"Validation failed: {e}."

            else:
                is_valid = True

            if is_valid:
                logger.info(f"Sending final response (Attempt {attempt}).")
                yield {
                    "is_task_complete": True,
                    "content": final_response_content,
                }
                return

            if attempt <= max_retries:
                logger.warning(f"Retrying... ({attempt}/{max_retries + 1})")
                current_query_text = (
                    f"Your previous response was invalid. {error_message} "
                    "You MUST generate a valid response following the A2UI JSON SCHEMA. "
                    f"Please retry: '{query}'"
                )

        logger.error("Max retries exhausted. Sending text-only error.")
        yield {
            "is_task_complete": True,
            "content": (
                "I'm sorry, I'm having trouble generating the interface. "
                "Please try again in a moment."
            ),
        }


# Backward compatibility alias
RestaurantAgent = UIGeneratorAgent
