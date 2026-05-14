"""
CopilotKit Middleware for LangGraph agents.

Works with any agent (prebuilt or custom).

Example:
    from langgraph.prebuilt import create_agent
    from copilotkit import CopilotKitMiddleware

    agent = create_agent(
        model="openai:gpt-4o",
        tools=[backend_tool],
        middleware=[CopilotKitMiddleware()],
    )
"""

import json
import re
from typing import Any, Callable, Awaitable, ClassVar, Iterable, List, Union

from langchain_core.messages import AIMessage, SystemMessage, ToolMessage
from langchain.agents.middleware import (
    AgentMiddleware,
    AgentState,
    ModelRequest,
    ModelResponse,
)
from langgraph.runtime import Runtime

from .langgraph import CopilotKitProperties


class StateSchema(AgentState):
    copilotkit: CopilotKitProperties


# Internal/framework keys that should never be surfaced to the LLM as
# user-facing state. These are either reducer-managed message buckets,
# CopilotKit/AG-UI plumbing, or graph-internal scaffolding.
_RESERVED_STATE_KEYS = frozenset(
    {
        "messages",
        "copilotkit",
        "ag-ui",
        "tools",
        "structured_response",
        "thread_id",
        "remaining_steps",
    }
)


class CopilotKitMiddleware(AgentMiddleware[StateSchema, Any]):
    """CopilotKit Middleware for LangGraph agents.

    Handles frontend tool injection, interception for CopilotKit, and
    automatic exposure of agent state to the LLM so values written via
    ``agent.setState`` on the frontend (or via ``Command(update=...)`` in a
    tool) are visible in the next model call without needing a custom
    ``get_state`` tool.

    Args:
        expose_state: Controls how user-defined state keys are surfaced into
            ``request.system_message`` on every model call. Off by default
            to avoid leaking arbitrary state into prompts; opt in explicitly.

            - ``False`` (default) — never surface state.
            - ``True`` — every state key that is not in the reserved
              internal set and does not start with an underscore is
              JSON-serialized into a "Current agent state:" note appended
              to the system message.
            - ``list``/``tuple``/``set[str]`` — only surface the named keys.
              Use this when you want explicit control over what the LLM
              sees (e.g. ``["liked", "todos"]``).
    """

    state_schema = StateSchema
    tools: ClassVar[list] = []

    def __init__(
        self,
        *,
        expose_state: Union[bool, Iterable[str]] = False,
    ):
        super().__init__()
        if isinstance(expose_state, bool):
            self._expose_state: Union[bool, frozenset[str]] = expose_state
        else:
            self._expose_state = frozenset(expose_state)

    @property
    def name(self) -> str:
        return "CopilotKitMiddleware"

    # ------------------------------------------------------------------
    # State-to-prompt surfacing
    # ------------------------------------------------------------------

    def _build_state_note(self, state: dict) -> str | None:
        """Serialize a snapshot of user state into a system-prompt note.

        Returns ``None`` when nothing should be appended (feature disabled
        or no non-empty user keys present).
        """
        if self._expose_state is False:
            return None
        if isinstance(self._expose_state, frozenset):
            keys: list[str] = [k for k in self._expose_state if k in state]
        else:
            keys = [
                k
                for k in state
                if k not in _RESERVED_STATE_KEYS and not str(k).startswith("_")
            ]

        snapshot: dict[str, Any] = {}
        for k in keys:
            v = state.get(k)
            # Skip empty / no-op values to keep the note tight.
            if v in (None, "", [], {}):
                continue
            snapshot[k] = v

        if not snapshot:
            return None

        try:
            body = json.dumps(snapshot, default=str, ensure_ascii=False, indent=2)
        except (TypeError, ValueError):
            body = str(snapshot)
        return f"Current agent state:\n{body}"

    def _apply_state_note(self, request: ModelRequest) -> ModelRequest:
        note = self._build_state_note(request.state or {})
        if not note:
            return request
        existing = request.system_message
        if existing is None:
            return request.override(system_message=SystemMessage(content=note))
        base = (
            existing.content
            if isinstance(existing.content, str)
            else str(existing.content)
        )
        return request.override(
            system_message=SystemMessage(content=f"{base}\n\n{note}")
        )

    # Inject frontend tools and surface user state before model call
    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelResponse:
        request = self._apply_state_note(request)
        frontend_tools = request.state.get("copilotkit", {}).get("actions", [])

        if not frontend_tools:
            return handler(request)

        # Merge frontend tools with existing tools
        merged_tools = [*request.tools, *frontend_tools]

        return handler(request.override(tools=merged_tools))

    @staticmethod
    def _fix_messages_for_bedrock(messages: list) -> list:
        """Fix messages loaded from checkpoint before sending to Bedrock.

        Handles four issues caused by CopilotKit's after_agent restoring
        frontend tool_calls to the checkpoint:
        1. Strip unanswered tool_calls (no matching ToolMessage) — Bedrock
           rejects toolUse without a corresponding toolResult.
        2. Sync msg.content tool_use blocks with msg.tool_calls.
        3. Fix tool_use content blocks with string input (must be dict).
        4. Deduplicate ToolMessages by tool_call_id — patch_orphan_tool_calls
           injects a placeholder with a new random ID on every checkpoint load;
           when the real result is later appended alongside it, Bedrock rejects
           the duplicate toolResult IDs. We keep the real result (non-interrupted)
           over the placeholder, falling back to the last occurrence if both look
           real.
        """
        # 4. Deduplicate ToolMessages by tool_call_id before all other processing.
        #    patch_orphan_tool_calls adds "…was interrupted before completion."
        #    placeholders with fresh random IDs on every checkpoint load. The real
        #    result comes in as a separate message with a different ID, so both end
        #    up in the list. Keep the real (non-interrupted) one; if multiple real
        #    ones exist, keep the last.
        _INTERRUPTED_PAT = re.compile(
            r"^Tool call '.+' with id '.+' was interrupted before completion\.$"
        )
        # Group ToolMessages by tool_call_id, preserving position
        tc_groups: dict[str, list] = {}
        for i, msg in enumerate(messages):
            if isinstance(msg, ToolMessage):
                tc_id = getattr(msg, "tool_call_id", None)
                if tc_id:
                    tc_groups.setdefault(tc_id, []).append(i)

        drop_indices: set = set()
        for tc_id, indices in tc_groups.items():
            if len(indices) <= 1:
                continue
            # Separate interrupted placeholders from real results
            real_indices = [
                i
                for i in indices
                if not (
                    isinstance(messages[i].content, str)
                    and _INTERRUPTED_PAT.match(messages[i].content)
                )
            ]
            interrupted_indices = [i for i in indices if i not in real_indices]
            if real_indices and interrupted_indices:
                # Replace the first placeholder (correct position, adjacent to AI
                # message) with the last real result (likely appended at the end).
                # This keeps the tool result in the right position for Bedrock.
                messages[interrupted_indices[0]] = messages[real_indices[-1]]
                drop_indices.update(interrupted_indices[1:])
                drop_indices.update(real_indices)  # drop all originals (we moved one)
            elif real_indices:
                # No placeholders, multiple real — keep only the last
                drop_indices.update(real_indices[:-1])
            else:
                # All interrupted — keep only the last
                drop_indices.update(interrupted_indices[:-1])

        if drop_indices:
            messages[:] = [
                msg for i, msg in enumerate(messages) if i not in drop_indices
            ]

        for idx, msg in enumerate(messages):
            if not isinstance(msg, AIMessage):
                continue

            tool_calls = getattr(msg, "tool_calls", None) or []

            # 1. Sync content with tool_calls: remove tool_use content blocks
            #    that aren't in msg.tool_calls (e.g. stripped by after_model
            #    but content blocks left behind in checkpoint).
            if tool_calls and isinstance(msg.content, list):
                tc_ids = {tc.get("id") for tc in tool_calls}
                msg.content = [
                    block
                    for block in msg.content
                    if not (
                        isinstance(block, dict)
                        and block.get("type") == "tool_use"
                        and block.get("id") not in tc_ids
                    )
                ]
            elif not tool_calls and isinstance(msg.content, list):
                # No tool_calls at all — strip ALL tool_use content blocks
                msg.content = [
                    block
                    for block in msg.content
                    if not (isinstance(block, dict) and block.get("type") == "tool_use")
                ]

            if not tool_calls:
                continue

            # 2. Strip unanswered tool_calls — only consider ToolMessages that
            #    are ADJACENT (immediately following this AIMessage, before the
            #    next non-ToolMessage). A ToolMessage at the wrong position
            #    won't satisfy Bedrock's Converse API requirement that toolResult
            #    blocks appear in the user turn right after the assistant turn.
            adjacent_tc_ids: set = set()
            j = idx + 1
            while j < len(messages) and isinstance(messages[j], ToolMessage):
                tc_id = getattr(messages[j], "tool_call_id", None)
                if tc_id:
                    adjacent_tc_ids.add(tc_id)
                j += 1

            unanswered = [
                tc for tc in tool_calls if tc.get("id") not in adjacent_tc_ids
            ]
            if unanswered:
                unanswered_ids = {tc["id"] for tc in unanswered}
                msg.tool_calls = [
                    tc for tc in tool_calls if tc.get("id") in adjacent_tc_ids
                ]

                # Also strip matching content blocks
                if isinstance(msg.content, list):
                    msg.content = [
                        block
                        for block in msg.content
                        if not (
                            isinstance(block, dict)
                            and block.get("type") == "tool_use"
                            and block.get("id") in unanswered_ids
                        )
                    ]

            # 3. Fix string args in tool_calls
            for tc in msg.tool_calls or []:
                if isinstance(tc.get("args"), str):
                    try:
                        tc["args"] = json.loads(tc["args"])
                    except (json.JSONDecodeError, TypeError):
                        tc["args"] = {}

            # 4. Fix string input in content blocks
            if isinstance(msg.content, list):
                for block in msg.content:
                    if isinstance(block, dict) and block.get("type") == "tool_use":
                        inp = block.get("input")
                        if isinstance(inp, str):
                            try:
                                block["input"] = json.loads(inp) if inp else {}
                            except (json.JSONDecodeError, TypeError):
                                block["input"] = {}
                        elif inp is None:
                            block["input"] = {}

        # 5. Remove orphan ToolMessages whose tool_call_id no longer matches
        #    any remaining tool_call in any AIMessage. These can be left over
        #    after stripping unanswered tool_calls above.
        remaining_tc_ids: set = set()
        for msg in messages:
            if isinstance(msg, AIMessage):
                for tc in getattr(msg, "tool_calls", None) or []:
                    tc_id = tc.get("id")
                    if tc_id:
                        remaining_tc_ids.add(tc_id)
        messages[:] = [
            msg
            for msg in messages
            if not isinstance(msg, ToolMessage)
            or getattr(msg, "tool_call_id", None) in remaining_tc_ids
        ]

        return messages

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse:
        self._fix_messages_for_bedrock(request.messages)
        request = self._apply_state_note(request)

        frontend_tools = request.state.get("copilotkit", {}).get("actions", [])

        if not frontend_tools:
            return await handler(request)

        # Merge frontend tools with existing tools
        merged_tools = [*request.tools, *frontend_tools]

        return await handler(request.override(tools=merged_tools))

    # Inject app context before agent runs
    def before_agent(
        self,
        state: StateSchema,
        runtime: Runtime[Any],
    ) -> dict[str, Any] | None:
        messages = state.get("messages", [])

        if not messages:
            return None

        # Get app context from state or runtime
        copilotkit_state = state.get("copilotkit", {})
        app_context = copilotkit_state.get("context") or getattr(
            runtime, "context", None
        )

        # Check if app_context is missing or empty
        if not app_context:
            return None
        if isinstance(app_context, str) and app_context.strip() == "":
            return None
        if isinstance(app_context, dict) and len(app_context) == 0:
            return None

        # Create the context content
        if isinstance(app_context, str):
            context_content = app_context
        else:
            # Handle Pydantic models (e.g. ag_ui Context)
            if hasattr(app_context, "model_dump"):
                app_context = app_context.model_dump()
            elif isinstance(app_context, list):
                app_context = [
                    item.model_dump() if hasattr(item, "model_dump") else item
                    for item in app_context
                ]
            context_content = json.dumps(app_context, indent=2)

        context_message_content = f"App Context:\n{context_content}"
        context_message_prefix = "App Context:\n"

        # Helper to get message content as string
        def get_content_string(msg: Any) -> str | None:
            content = getattr(msg, "content", None)
            if isinstance(content, str):
                return content
            if isinstance(content, list) and content and isinstance(content[0], dict):
                return content[0].get("text")
            return None

        # Find the first system/developer message (not our context message)
        # to determine where to insert our context message (right after it)
        first_system_index = -1

        for i, msg in enumerate(messages):
            msg_type = getattr(msg, "type", None)
            if msg_type in ("system", "developer"):
                content = get_content_string(msg)
                # Skip if this is our own context message
                if content and content.startswith(context_message_prefix):
                    continue
                first_system_index = i
                break

        # Check if our context message already exists
        existing_context_index = -1
        for i, msg in enumerate(messages):
            msg_type = getattr(msg, "type", None)
            if msg_type in ("system", "developer"):
                content = get_content_string(msg)
                if content and content.startswith(context_message_prefix):
                    existing_context_index = i
                    break

        # Create the context message.
        # When replacing an existing context message, reuse its ID so the
        # add_messages reducer updates in-place instead of appending a
        # duplicate at the end of the message list.
        if existing_context_index != -1:
            existing_id = getattr(messages[existing_context_index], "id", None)
            context_message = SystemMessage(
                content=context_message_content, id=existing_id
            )
        else:
            context_message = SystemMessage(content=context_message_content)

        if existing_context_index != -1:
            # Replace existing context message
            updated_messages = list(messages)
            updated_messages[existing_context_index] = context_message
        else:
            # Insert after the first system message, or at position 0 if no system message
            insert_index = first_system_index + 1 if first_system_index != -1 else 0
            updated_messages = [
                *messages[:insert_index],
                context_message,
                *messages[insert_index:],
            ]

        return {
            **state,
            "messages": updated_messages,
        }

    async def abefore_agent(
        self,
        state: StateSchema,
        runtime: Runtime[Any],
    ) -> dict[str, Any] | None:
        # Delegate to sync implementation
        return self.before_agent(state, runtime)

    # Intercept frontend tool calls after model returns, before ToolNode executes
    def after_model(
        self,
        state: StateSchema,
        runtime: Runtime[Any],
    ) -> dict[str, Any] | None:
        frontend_tools = state.get("copilotkit", {}).get("actions", [])
        if not frontend_tools:
            return None

        frontend_tool_names = {
            t.get("function", {}).get("name") or t.get("name") for t in frontend_tools
        }

        # Find last AI message with tool calls
        messages = state.get("messages", [])
        if not messages:
            return None

        last_message = messages[-1]
        if not isinstance(last_message, AIMessage):
            return None

        tool_calls = getattr(last_message, "tool_calls", None) or []
        if not tool_calls:
            return None

        backend_tool_calls = []
        frontend_tool_calls = []

        for call in tool_calls:
            if call.get("name") in frontend_tool_names:
                frontend_tool_calls.append(call)
            else:
                backend_tool_calls.append(call)

        if not frontend_tool_calls:
            return None

        # Create updated AIMessage with only backend tool calls
        updated_ai_message = AIMessage(
            content=last_message.content,
            tool_calls=backend_tool_calls,
            id=last_message.id,
        )

        return {
            "messages": [*messages[:-1], updated_ai_message],
            "copilotkit": {
                "intercepted_tool_calls": frontend_tool_calls,
                "original_ai_message_id": last_message.id,
            },
        }

    async def aafter_model(
        self,
        state: StateSchema,
        runtime: Runtime[Any],
    ) -> dict[str, Any] | None:
        # Delegate to sync implementation
        return self.after_model(state, runtime)

    # Restore frontend tool calls to AIMessage before agent exits
    def after_agent(
        self,
        state: StateSchema,
        runtime: Runtime[Any],
    ) -> dict[str, Any] | None:
        copilotkit_state = state.get("copilotkit", {})
        intercepted_tool_calls = copilotkit_state.get("intercepted_tool_calls")
        original_message_id = copilotkit_state.get("original_ai_message_id")

        if not intercepted_tool_calls or not original_message_id:
            return None

        messages = state.get("messages", [])
        updated_messages = []

        for msg in messages:
            if isinstance(msg, AIMessage) and msg.id == original_message_id:
                existing_tool_calls = getattr(msg, "tool_calls", None) or []
                updated_messages.append(
                    AIMessage(
                        content=msg.content,
                        tool_calls=[*existing_tool_calls, *intercepted_tool_calls],
                        id=msg.id,
                    )
                )
            else:
                updated_messages.append(msg)

        return {
            "messages": updated_messages,
            "copilotkit": {
                "intercepted_tool_calls": None,
                "original_ai_message_id": None,
            },
        }

    async def aafter_agent(
        self,
        state: StateSchema,
        runtime: Runtime[Any],
    ) -> dict[str, Any] | None:
        # Delegate to sync implementation
        return self.after_agent(state, runtime)
