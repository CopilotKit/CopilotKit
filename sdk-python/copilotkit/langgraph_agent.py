"""LangGraph agent for CopilotKit"""

import uuid
from typing import Optional, List, Callable, Any, cast, Union, TypedDict
from typing_extensions import NotRequired

from langgraph.graph.graph import CompiledGraph
from langchain.load.dump import dumps as langchain_dumps
from langchain.schema import BaseMessage, SystemMessage
from langchain_core.runnables import RunnableConfig, ensure_config
from langchain_core.messages import AIMessage, ToolMessage

from partialjson.json_parser import JSONParser

from .types import Message
from .langchain import copilotkit_messages_to_langchain
from .action import ActionDict
from .agent import Agent
from .logging import get_logger

logger = get_logger(__name__)

class CopilotKitConfig(TypedDict):
    """CopilotKit config"""
    merge_state: NotRequired[Callable]
    convert_messages: NotRequired[Callable]

def langgraph_default_merge_state( # pylint: disable=unused-argument
        *,
        state: dict,
        messages: List[BaseMessage],
        actions: List[Any],
        agent_name: str
    ):
    """Default merge state for LangGraph"""
    if len(messages) > 0 and isinstance(messages[0], SystemMessage):
        # remove system message
        messages = messages[1:]


    # merge with existing messages
    merged_messages = state.get("messages", [])
    existing_message_ids = {message.id for message in merged_messages}
    existing_tool_call_results = set()

    for message in merged_messages:
        if isinstance(message, ToolMessage):
            existing_tool_call_results.add(message.tool_call_id)

    for message in messages:
        # filter tool calls to activate the agent itself
        if (
            isinstance(message, AIMessage) and
            message.tool_calls and
            message.tool_calls[0]["name"] == agent_name
        ):
            continue

        # filter results from activating the agent
        if (
            isinstance(message, ToolMessage) and
            message.name == agent_name
        ):
            continue

        if message.id not in existing_message_ids:

            # skip duplicate tool call results
            if (isinstance(message, ToolMessage) and
                message.tool_call_id in existing_tool_call_results):
                logger.warning(
                    "Warning: Duplicate tool call result, skipping: %s",
                    message.tool_call_id
                )
                continue

            merged_messages.append(message)
        else:
            # Replace the message with the existing one
            for i, existing_message in enumerate(merged_messages):
                if existing_message.id == message.id:
                    # if the message is an AIMessage, we need to merge
                    # the tool calls and additional kwargs
                    if isinstance(message, AIMessage):
                        if (
                            (merged_messages[i].tool_calls or
                             merged_messages[i].additional_kwargs) and
                            merged_messages[i].content
                        ):
                            message.tool_calls = merged_messages[i].tool_calls
                            message.additional_kwargs = merged_messages[i].additional_kwargs
                    merged_messages[i] = message

    # fix wrong tool call ids
    for i, current_message in enumerate(merged_messages):
        if i == len(merged_messages) - 1:
            break
        next_message = merged_messages[i + 1]
        if (not isinstance(current_message, AIMessage) or
            not isinstance(next_message, ToolMessage)):
            continue

        if current_message.tool_calls and current_message.tool_calls[0]["id"]:
            next_message.tool_call_id = current_message.tool_calls[0]["id"]

    # try to auto-correct and log alignment issues
    corrected_messages = []

    for i, current_message in enumerate(merged_messages):
        next_message = merged_messages[i + 1] if i < len(merged_messages) - 1 else None
        prev_message = merged_messages[i - 1] if i > 0 else None

        if isinstance(current_message, AIMessage) and current_message.tool_calls:
            # ensure the next message is a ToolMessage
            if not next_message:
                # no next message, so we can't auto-correct
                logger.warning(
                    "No next message to auto-correct tool call, skipping: %s",
                    current_message.tool_calls[0]["id"]
                )
                continue

            if ((not isinstance(next_message, ToolMessage)) or
                next_message.tool_call_id != current_message.tool_calls[0]["id"]):
                # next message is not a tool message or the tool call id is incorrect

                # try to find the corresponding tool call result
                tool_message = next((m for m in merged_messages
                                     if isinstance(m, ToolMessage) and 
                                     m.tool_call_id == current_message.tool_calls[0]["id"]), 
                                     None)
                if tool_message:
                    # we found the corresponding tool call result
                    # append the current message and the tool call result
                    logger.warning(
                        "Auto-corrected tool call alignment issue: %s",
                        current_message.tool_calls[0]["id"]
                    )
                    corrected_messages.append(current_message)
                    corrected_messages.append(tool_message)
                    continue
                else:
                    # no corresponding tool call result found for tool call
                    logger.warning(
                        "No corresponding tool call result found for tool call, skipping: %s",
                        current_message.tool_calls[0]["id"]
                    )
                    continue

            # all good, append the current message
            corrected_messages.append(current_message)
            continue

        if isinstance(current_message, ToolMessage):
            # ensure the previous message is an AIMessage
            if not prev_message or not isinstance(prev_message, AIMessage):
                # no previous message, so we can't auto-correct
                logger.warning(
                    "No previous tool call, skipping tool call result: %s",
                    current_message.id
                )
                continue

            if (prev_message.tool_calls and
                prev_message.tool_calls[0]["id"] != current_message.tool_call_id):
                # the tool call id is incorrect
                logger.warning(
                    "Tool call id is incorrect, skipping tool call result: %s",
                    current_message.id
                )
                continue

            # all good, append the current message
            corrected_messages.append(current_message)
            continue

        # append all other messages
        corrected_messages.append(current_message)


    return {
        **state,
        "messages": corrected_messages,
        "copilotkit": {
            "actions": actions
        }
    }

class LangGraphAgent(Agent):
    """LangGraph agent class for CopilotKit"""
    def __init__(
            self,
            *,
            name: str,
            description: Optional[str] = None,
            graph: Optional[CompiledGraph] = None,
            langgraph_config:  Union[Optional[RunnableConfig], dict] = None,
            copilotkit_config: Optional[CopilotKitConfig] = None,

            # deprecated - use langgraph_config instead
            config: Union[Optional[RunnableConfig], dict] = None,
            # deprecated - use graph instead
            agent: Optional[CompiledGraph] = None,
            # deprecated - use copilotkit_config instead
            merge_state: Optional[Callable] = None,

        ):
        if config is not None:
            logger.warning("Warning: config is deprecated, use langgraph_config instead")

        if agent is not None:
            logger.warning("Warning: agent is deprecated, use graph instead")

        if merge_state is None:
            logger.warning("Warning: merge_state is deprecated, use copilotkit_config instead")
        
        if graph is None and agent is None:
            raise ValueError("graph must be provided")

        super().__init__(
            name=name,
            description=description,
        )

        self.merge_state = None

        if copilotkit_config is not None:
            self.merge_state = copilotkit_config.get("merge_state")
        if not self.merge_state and merge_state is not None:
            self.merge_state = merge_state
        if not self.merge_state:
            self.merge_state = langgraph_default_merge_state

        self.convert_messages = (
            copilotkit_config.get("convert_messages")
            if copilotkit_config
            else None
        ) or copilotkit_messages_to_langchain(use_function_call=False)

        self.langgraph_config = langgraph_config or config

        self.graph = cast(CompiledGraph, graph or agent)

    def _emit_state_sync_event(
            self,
            *,
            thread_id: str,
            run_id: str,
            node_name: str,
            state: dict,
            running: bool,
            active: bool
        ):
        state_without_messages = {
            k: v for k, v in state.items() if k != "messages"
        }
        return langchain_dumps({
            "event": "on_copilotkit_state_sync",
            "thread_id": thread_id,
            "run_id": run_id,
            "agent_name": self.name,
            "node_name": node_name,
            "active": active,
            "state": state_without_messages,
            "running": running,
            "role": "assistant"
        })

    def execute( # pylint: disable=too-many-arguments            
        self,
        *,
        state: dict,
        messages: List[Message],
        thread_id: Optional[str] = None,
        node_name: Optional[str] = None,
        actions: Optional[List[ActionDict]] = None,
    ):
        config = ensure_config(cast(Any, self.langgraph_config.copy()) if self.langgraph_config else {}) # pylint: disable=line-too-long
        config["configurable"] = config.get("configurable", {})
        config["configurable"]["thread_id"] = thread_id

        agent_state = self.graph.get_state(config)
        state["messages"] = agent_state.values.get("messages", [])

        langchain_messages = self.convert_messages(messages)
        state = cast(Callable, self.merge_state)(
            state=state,
            messages=langchain_messages,
            actions=actions,
            agent_name=self.name
        )

        mode = "continue" if thread_id and node_name != "__end__" else "start"
        thread_id = thread_id or str(uuid.uuid4())
        config["configurable"]["thread_id"] = thread_id

        if mode == "continue":
            self.graph.update_state(config, state, as_node=node_name)

        return self._stream_events(
            mode=mode,
            config=config,
            state=state,
            node_name=node_name
        )

    async def _stream_events( # pylint: disable=too-many-locals
            self,
            *,
            mode: str,
            config: RunnableConfig,
            state: Any,
            node_name: Optional[str] = None
        ):

        streaming_state_extractor = _StreamingStateExtractor([])
        initial_state = state if mode == "start" else None
        prev_node_name = None
        emit_intermediate_state_until_end = None
        should_exit = False
        manually_emitted_state = None
        thread_id = cast(Any, config)["configurable"]["thread_id"]

        async for event in self.graph.astream_events(initial_state, config, version="v2"):
            current_node_name = event.get("name")
            event_type = event.get("event")
            run_id = event.get("run_id")
            metadata = event.get("metadata", {})

            should_exit = should_exit or (
                event_type == "on_custom_event" and
                event["name"] == "copilotkit_exit"
            )

            emit_intermediate_state = metadata.get("copilotkit:emit-intermediate-state")
            manually_emit_intermediate_state = (
                event_type == "on_custom_event" and
                event["name"] == "copilotkit_manually_emit_intermediate_state"
            )

            # we only want to update the node name under certain conditions
            # since we don't need any internal node names to be sent to the frontend
            if current_node_name in self.graph.nodes.keys():
                node_name = current_node_name

            # we don't have a node name yet, so we can't update the state
            if node_name is None:
                continue

            exiting_node = node_name == current_node_name and event_type == "on_chain_end"

            if exiting_node:
                manually_emitted_state = None

            if manually_emit_intermediate_state:
                manually_emitted_state = cast(Any, event["data"])
                yield self._emit_state_sync_event(
                    thread_id=thread_id,
                    run_id=run_id,
                    node_name=node_name,
                    state=manually_emitted_state,
                    running=True,
                    active=True
                ) + "\n"
                continue


            if emit_intermediate_state and emit_intermediate_state_until_end is None:
                emit_intermediate_state_until_end = node_name

            if emit_intermediate_state and event_type == "on_chat_model_start":
                # reset the streaming state extractor
                streaming_state_extractor = _StreamingStateExtractor(emit_intermediate_state)

            updated_state = manually_emitted_state or self.graph.get_state(config).values

            if emit_intermediate_state and event_type == "on_chat_model_stream":
                streaming_state_extractor.buffer_tool_calls(event)

            if emit_intermediate_state_until_end is not None:
                updated_state = {
                    **updated_state,
                    **streaming_state_extractor.extract_state()
                }

            if (not emit_intermediate_state and
                current_node_name == emit_intermediate_state_until_end and
                event_type == "on_chain_end"):
                # stop emitting function call state
                emit_intermediate_state_until_end = None

            # we send state sync events when:
            #   a) the state has changed
            #   b) the node has changed
            #   c) the node is ending
            if updated_state != state or prev_node_name != node_name or exiting_node:
                state = updated_state
                prev_node_name = node_name
                yield self._emit_state_sync_event(
                    thread_id=thread_id,
                    run_id=run_id,
                    node_name=node_name,
                    state=state,
                    running=True,
                    active=not exiting_node
                ) + "\n"

            yield langchain_dumps(event) + "\n"

        state = self.graph.get_state(config)
        is_end_node = state.next == ()

        node_name = list(state.metadata["writes"].keys())[0]

        yield self._emit_state_sync_event(
            thread_id=thread_id,
            run_id=run_id,
            node_name=cast(str, node_name) if not is_end_node else "__end__",
            state=state.values,
            running=not should_exit,
            # at this point, the node is ending so we set active to false
            active=False
        ) + "\n"



    def dict_repr(self):
        super_repr = super().dict_repr()
        return {
            **super_repr,
            'type': 'langgraph'
        }

class _StreamingStateExtractor:
    def __init__(self, emit_intermediate_state: List[dict]):
        self.emit_intermediate_state = emit_intermediate_state
        self.tool_call_buffer = {}
        self.current_tool_call = None

        self.previously_parsable_state = {}

    def buffer_tool_calls(self, event: Any):
        """Buffer the tool calls"""
        if len(event["data"]["chunk"].tool_call_chunks) > 0:
            chunk = event["data"]["chunk"].tool_call_chunks[0]
            if chunk["name"] is not None:
                self.current_tool_call = chunk["name"]
                self.tool_call_buffer[self.current_tool_call] = chunk["args"]
            elif self.current_tool_call is not None:
                self.tool_call_buffer[self.current_tool_call] = (
                    self.tool_call_buffer[self.current_tool_call] + chunk["args"]
                )

    def get_emit_state_config(self, current_tool_name):
        """Get the emit state config"""

        for config in self.emit_intermediate_state:
            state_key = config.get("state_key")
            tool = config.get("tool")
            tool_argument = config.get("tool_argument")

            if current_tool_name == tool:
                return (tool_argument, state_key)

        return (None, None)


    def extract_state(self):
        """Extract the streaming state"""
        parser = JSONParser()

        state = {}

        for key, value in self.tool_call_buffer.items():
            argument_name, state_key = self.get_emit_state_config(key)

            if state_key is None:
                continue

            try:
                parsed_value = parser.parse(value)
            except Exception as _exc: # pylint: disable=broad-except
                if key in self.previously_parsable_state:
                    parsed_value = self.previously_parsable_state[key]
                else:
                    continue

            self.previously_parsable_state[key] = parsed_value

            if argument_name is None:
                state[state_key] = parsed_value
            else:
                state[state_key] = parsed_value.get(argument_name)

        return state
