"""
UIGeneratorAgent - A2A agent with A2UI support for dynamic UI generation.

This agent uses Google ADK with LiteLLM to generate A2UI declarative JSON
responses that render rich, interactive UIs for any user request.
"""

import json
import logging
import os
from collections.abc import AsyncIterable
from typing import Any

import jsonschema
from google.adk.agents.llm_agent import LlmAgent
from google.adk.artifacts import InMemoryArtifactService
from google.adk.memory.in_memory_memory_service import InMemoryMemoryService
from google.adk.models.lite_llm import LiteLlm
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from .prompt_builder import (
    A2UI_SCHEMA,
    UI_EXAMPLES,
    get_text_prompt,
    get_ui_prompt,
)

logger = logging.getLogger(__name__)

# Agent instruction for general-purpose UI generation
AGENT_INSTRUCTION = """
You are a UI generation assistant. You create any user interface using A2UI declarative JSON.

**Your capabilities:**
- Forms: Contact forms, signup forms, surveys, settings panels, feedback forms
- Lists: Todo lists, shopping lists, search results, notifications, item catalogs
- Cards: Profile cards, product cards, info cards, stats cards, notification cards
- Confirmations: Success messages, error alerts, booking confirmations, status updates

**How to generate UI:**
1. Listen to what UI the user wants
2. Choose the appropriate template as your starting pattern:
   - For forms: Use FORM_EXAMPLE
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
        self._agent = self._build_agent(use_ui)
        self._user_id = "remote_agent"
        self._runner = Runner(
            app_name=self._agent.name,
            agent=self._agent,
            artifact_service=InMemoryArtifactService(),
            session_service=InMemorySessionService(),
            memory_service=InMemoryMemoryService(),
        )

        # Load and prepare the A2UI schema for validation
        try:
            single_message_schema = json.loads(A2UI_SCHEMA)
            # The LLM returns a list of messages, so wrap schema in array validator
            self.a2ui_schema_object = {"type": "array", "items": single_message_schema}
            logger.info("A2UI_SCHEMA successfully loaded for validation.")
        except json.JSONDecodeError as e:
            logger.error(f"CRITICAL: Failed to parse A2UI_SCHEMA: {e}")
            self.a2ui_schema_object = None

    def get_processing_message(self) -> str:
        """Returns a message to show while processing."""
        return "Generating your UI..."

    def _build_agent(self, use_ui: bool) -> LlmAgent:
        """Builds the LLM agent with appropriate configuration."""
        LITELLM_MODEL = os.getenv("LITELLM_MODEL", "openai/gpt-5.2")

        if use_ui:
            # Construct prompt with UI instructions, examples, and schema
            instruction = AGENT_INSTRUCTION + get_ui_prompt(self.base_url, UI_EXAMPLES)
        else:
            instruction = get_text_prompt()

        return LlmAgent(
            model=LiteLlm(model=LITELLM_MODEL),
            name="ui_generator_agent",
            description="An agent that generates any UI using A2UI declarative JSON.",
            instruction=instruction,
            tools=[],  # No tools needed - UI is generated from user descriptions
        )

    async def stream(self, query: str, session_id: str) -> AsyncIterable[dict[str, Any]]:
        """
        Stream agent responses for a query.

        Args:
            query: The user's query text.
            session_id: Session identifier for conversation continuity.

        Yields:
            Dict containing response content and completion status.
        """
        session_state = {"base_url": self.base_url}

        # Get or create session
        session = await self._runner.session_service.get_session(
            app_name=self._agent.name,
            user_id=self._user_id,
            session_id=session_id,
        )
        if session is None:
            session = await self._runner.session_service.create_session(
                app_name=self._agent.name,
                user_id=self._user_id,
                state=session_state,
                session_id=session_id,
            )
        elif "base_url" not in session.state:
            session.state["base_url"] = self.base_url

        # UI Validation and Retry Logic
        max_retries = 1
        attempt = 0
        current_query_text = query

        # Check schema was loaded
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

        while attempt <= max_retries:
            attempt += 1
            logger.info(
                f"UIGeneratorAgent.stream: Attempt {attempt}/{max_retries + 1} "
                f"for session {session_id}"
            )

            current_message = types.Content(
                role="user", parts=[types.Part.from_text(text=current_query_text)]
            )
            final_response_content = None

            async for event in self._runner.run_async(
                user_id=self._user_id,
                session_id=session.id,
                new_message=current_message,
            ):
                logger.debug(f"Event from runner: {event}")
                if event.is_final_response():
                    if (
                        event.content
                        and event.content.parts
                        and event.content.parts[0].text
                    ):
                        final_response_content = "\n".join(
                            [p.text for p in event.content.parts if p.text]
                        )
                    break
                else:
                    # Yield intermediate updates
                    yield {
                        "is_task_complete": False,
                        "updates": self.get_processing_message(),
                    }

            if final_response_content is None:
                logger.warning(f"No final response content from runner (Attempt {attempt}).")
                if attempt <= max_retries:
                    current_query_text = (
                        f"I received no response. Please retry: '{query}'"
                    )
                    continue
                else:
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

                    text_part, json_string = final_response_content.split(
                        "---a2ui_JSON---", 1
                    )

                    if not json_string.strip():
                        raise ValueError("JSON part is empty.")

                    json_string_cleaned = (
                        json_string.strip().lstrip("```json").rstrip("```").strip()
                    )

                    if not json_string_cleaned:
                        raise ValueError("Cleaned JSON string is empty.")

                    # Parse and validate JSON
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
                # Text-only mode is always valid
                is_valid = True

            if is_valid:
                logger.info(f"Sending final response (Attempt {attempt}).")
                yield {
                    "is_task_complete": True,
                    "content": final_response_content,
                }
                return

            # Validation failed - retry if attempts remain
            if attempt <= max_retries:
                logger.warning(f"Retrying... ({attempt}/{max_retries + 1})")
                current_query_text = (
                    f"Your previous response was invalid. {error_message} "
                    "You MUST generate a valid response following the A2UI JSON SCHEMA. "
                    f"Please retry: '{query}'"
                )

        # Exhausted retries
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
