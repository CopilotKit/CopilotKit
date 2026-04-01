"""
UIGeneratorExecutor - A2A executor for the general-purpose UI generator agent.

This executor handles incoming A2A requests, processes A2UI ClientEvents
(like button clicks and form submissions), and routes them to the UIGeneratorAgent.
"""

import json
import logging

from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.tasks import TaskUpdater
from a2a.types import (
    DataPart,
    Part,
    Task,
    TaskState,
    TextPart,
    UnsupportedOperationError,
)
from a2a.utils import (
    new_agent_parts_message,
    new_agent_text_message,
    new_task,
)
from a2a.utils.errors import ServerError

from .a2ui_extension import create_a2ui_part, try_activate_a2ui_extension
from .agent import UIGeneratorAgent

logger = logging.getLogger(__name__)


class UIGeneratorExecutor(AgentExecutor):
    """A2A executor for the general-purpose UI generator agent with A2UI support."""

    def __init__(self, base_url: str):
        """
        Initialize the executor with both UI and text agents.

        Args:
            base_url: Base URL for static assets.
        """
        # Create both agent variants - appropriate one chosen at execution time
        self.ui_agent = UIGeneratorAgent(base_url=base_url, use_ui=True)
        self.text_agent = UIGeneratorAgent(base_url=base_url, use_ui=False)

    async def execute(
        self,
        context: RequestContext,
        event_queue: EventQueue,
    ) -> None:
        """
        Execute agent request, handling A2UI events if present.

        Args:
            context: The A2A request context.
            event_queue: Queue for emitting events.
        """
        query = ""
        ui_event_part = None
        action = None

        logger.info(f"Client requested extensions: {context.requested_extensions}")
        use_ui = try_activate_a2ui_extension(context)

        # Select agent based on A2UI extension activation
        if use_ui:
            agent = self.ui_agent
            logger.info("A2UI extension active - using UI agent")
        else:
            agent = self.text_agent
            logger.info("A2UI extension not active - using text agent")

        # Process incoming message parts
        if context.message and context.message.parts:
            logger.info(f"Processing {len(context.message.parts)} message parts")
            for i, part in enumerate(context.message.parts):
                if isinstance(part.root, DataPart):
                    # Check for A2UI ClientEvent (button click, form submit, etc.)
                    if "userAction" in part.root.data:
                        logger.info(f"Part {i}: Found A2UI ClientEvent payload")
                        ui_event_part = part.root.data["userAction"]
                    else:
                        logger.info(f"Part {i}: DataPart with data")
                elif isinstance(part.root, TextPart):
                    logger.info(f"Part {i}: TextPart")
                else:
                    logger.info(f"Part {i}: Unknown type ({type(part.root)})")

        # Handle A2UI ClientEvents (button clicks from UI)
        if ui_event_part:
            logger.info(f"Received A2UI ClientEvent: {ui_event_part}")
            action = ui_event_part.get("actionName")
            ctx = ui_event_part.get("context", {})

            if action == "submit_form":
                # User submitted a form - extract all form data from context
                form_data = ", ".join(f"{k}: {v}" for k, v in ctx.items())
                query = f"User submitted a form with the following data: {form_data}"

            else:
                # Generic action handler - pass action name and context to LLM
                query = f"User action: {action} with data: {ctx}"
        else:
            # No UI event - use text input
            logger.info("No A2UI event - using text input")
            query = context.get_user_input()

        logger.info(f"Final query for LLM: '{query}'")

        # Get or create task
        task = context.current_task
        if not task:
            task = new_task(context.message)
            await event_queue.enqueue_event(task)
        updater = TaskUpdater(event_queue, task.id, task.context_id)

        # Stream agent response
        async for item in agent.stream(query, task.context_id):
            is_task_complete = item["is_task_complete"]

            if not is_task_complete:
                # Send progress update
                await updater.update_status(
                    TaskState.working,
                    new_agent_text_message(item["updates"], task.context_id, task.id),
                )
                continue

            # Determine final state based on action
            # Form submissions complete the task, other interactions require more input
            final_state = (
                TaskState.completed
                if action == "submit_form"
                else TaskState.input_required
            )

            content = item["content"]
            final_parts = []

            # Parse response for A2UI JSON
            if "---a2ui_JSON---" in content:
                logger.info("Splitting response into text and UI parts")
                text_content, json_string = content.split("---a2ui_JSON---", 1)

                if text_content.strip():
                    final_parts.append(Part(root=TextPart(text=text_content.strip())))

                if json_string.strip():
                    try:
                        json_string_cleaned = (
                            json_string.strip().lstrip("```json").rstrip("```").strip()
                        )
                        json_data = json.loads(json_string_cleaned)

                        if isinstance(json_data, list):
                            logger.info(
                                f"Found {len(json_data)} A2UI messages"
                            )
                            for message in json_data:
                                tmp = create_a2ui_part(message)
                                logger.info(f"A2UI message: {tmp}")
                                final_parts.append(tmp)
                        else:
                            # Single JSON object
                            logger.info("Single A2UI message")
                            final_parts.append(create_a2ui_part(json_data))

                    except json.JSONDecodeError as e:
                        logger.error(f"Failed to parse UI JSON: {e}")
                        final_parts.append(Part(root=TextPart(text=json_string)))
            else:
                # Text-only response
                final_parts.append(Part(root=TextPart(text=content.strip())))

            logger.info(f"Sending {len(final_parts)} parts")

            await updater.update_status(
                final_state,
                new_agent_parts_message(final_parts, task.context_id, task.id),
                final=(final_state == TaskState.completed),
            )
            break

    async def cancel(
        self, request: RequestContext, event_queue: EventQueue
    ) -> Task | None:
        """Cancel operation - not supported."""
        raise ServerError(error=UnsupportedOperationError())


# Backward compatibility alias
RestaurantAgentExecutor = UIGeneratorExecutor
