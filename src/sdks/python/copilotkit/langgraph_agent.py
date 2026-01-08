"""LangGraph agent for CopilotKit"""

import uuid
import json
from typing import Optional, List, Callable, Any, cast, Union, TypedDict, Literal

from langgraph.graph.state import CompiledStateGraph
from typing_extensions import NotRequired

from langgraph.types import Command

try:
    from langchain.load.dump import dumps as langchain_dumps
    from langchain.schema import BaseMessage, SystemMessage
except ImportError:
    # Langchain >= 1.0.0
    from langchain_core.load import dumps as langchain_dumps
    from langchain_core.messages import BaseMessage, SystemMessage
    
from langchain_core.runnables import RunnableConfig, ensure_config
from langchain_core.messages import HumanMessage

from partialjson.json_parser import JSONParser

from .types import Message, MetaEvent
from .utils import filter_by_schema_keys
from .langgraph import copilotkit_messages_to_langchain, langchain_messages_to_copilotkit
from .action import ActionDict
from .agent import Agent
from .logging import get_logger

logger = get_logger(__name__)

class CopilotKitConfig(TypedDict):
    """
    CopilotKit config for LangGraphAgent

    This is used for advanced cases where you want to customize how CopilotKit interacts with
    LangGraph.

    ```python
    # Function signatures:
    def merge_state(
        *,
        state: dict,
        messages: List[BaseMessage],
        actions: List[Any],
        agent_name: str
    ):
        # ...implementation...

    def convert_messages(messages: List[Message]):
        # ...implementation...
    ```

    Parameters
    ----------
    merge_state : Callable
        This function lets you customize how CopilotKit merges the agent state.
    convert_messages : Callable
        Use this function to customize how CopilotKit converts its messages to LangChain messages.`
    """
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

    existing_messages = state.get("messages", [])
    existing_message_ids = {message.id for message in existing_messages}

    new_messages = [message for message in messages if message.id not in existing_message_ids]

    return {
        **state,
        "messages": new_messages,
        "copilotkit": {
            "actions": actions
        }
    }


class LangGraphAgent(Agent):
    """
    LangGraphAgent lets you define your agent for use with CopilotKit.

    To install, run:

    ```bash
    pip install copilotkit
    ```

    ### Examples

    Every agent must have the `name` and `graph` properties defined. An optional `description`
    can also be provided. This is used when CopilotKit is dynamically routing requests to the
    agent.

    ```python
    from copilotkit import LangGraphAgent

    LangGraphAgent(
        name="email_agent",
        description="This agent sends emails",
        graph=graph,
    )
    ```

    If you have a custom LangGraph/LangChain config that you want to use with the agent, you can
    pass it in as the `langgraph_config` parameter.

    ```python
    LangGraphAgent(
        ...
        langgraph_config=config,
    )
    ```

    Parameters
    ----------
    name : str
        The name of the agent.
    graph : CompiledStateGraph
        The LangGraph graph to use with the agent.
    description : Optional[str]
        The description of the agent.
    langgraph_config : Optional[RunnableConfig]
        The LangGraph/LangChain config to use with the agent.
    copilotkit_config : Optional[CopilotKitConfig]
        The CopilotKit config to use with the agent.
    """
    def __init__(
            self,
            *,
            name: str,
            graph: Optional[CompiledStateGraph] = None,
            description: Optional[str] = None,
            langgraph_config:  Union[Optional[RunnableConfig], dict] = None,
            copilotkit_config: Optional[CopilotKitConfig] = None,

            # deprecated - use langgraph_config instead
            config: Union[Optional[RunnableConfig], dict] = None,
            # deprecated - use graph instead
            agent: Optional[CompiledStateGraph] = None,
            # deprecated - use copilotkit_config instead
            merge_state: Optional[Callable] = None,
        ):
        if config is not None:
            logger.warning("Warning: config is deprecated, use langgraph_config instead")

        if agent is not None:
            logger.warning("Warning: agent is deprecated, use graph instead")

        if merge_state is not None:
            logger.warning("Warning: merge_state is deprecated, use copilotkit_config instead")

        if graph is None and agent is None:
            raise ValueError("graph must be provided")

        super().__init__(
            name=name,
            description=description,
        )

        self.merge_state = None
        self.thread_state = {}
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

        self.graph = cast(CompiledStateGraph, graph or agent)
        self.active_interrupt_event = False

    def execute( # pylint: disable=too-many-arguments
            self,
            *,
            state: dict,
            config: Optional[dict] = None,
            messages: List[Message],
            thread_id: str,
            actions: Optional[List[ActionDict]] = None,
            meta_events: Optional[List[MetaEvent]] = None,
            **kwargs
    ):
        node_name = kwargs.get("node_name")

        return self._stream_events(
            state=state,
            config=config,
            messages=messages,
            actions=actions,
            thread_id=thread_id,
            node_name=node_name,
            meta_events=meta_events
        )

    async def prepare_stream( # pylint: disable=too-many-arguments
            self,
            *,
            state_input: Any,
            agent_state: Any,
            config: Optional[dict] = None,
            messages: List[Message],
            thread_id: str,
            actions: Optional[List[ActionDict]] = None,
            node_name: Optional[str] = None,
            meta_events: Optional[List[MetaEvent]] = None,
    ):
        active_interrupts = agent_state.tasks[0].interrupts if agent_state.tasks and agent_state.tasks[0].interrupts else None
        state_input["messages"] = agent_state.values.get("messages", [])
        current_graph_state = agent_state.values
        langchain_messages = self.convert_messages(messages)
        state = cast(Callable, self.merge_state)(
            state=state_input,
            messages=langchain_messages,
            actions=actions,
            agent_name=self.name
        )
        current_graph_state.update(state)
        lg_interrupt_meta_event = next((ev for ev in (meta_events or []) if ev.get("name") == "LangGraphInterruptEvent"), None)
        has_active_interrupts = active_interrupts is not None and len(active_interrupts) > 0

        resume_input = None

        # An active interrupt event that runs through messages. Use latest message as response
        if has_active_interrupts and lg_interrupt_meta_event is None:
            # state["messages"] only includes the messages we need to add at this point, tool call+result if applicable, and user text
            resume_input = Command(resume=state["messages"])

        if lg_interrupt_meta_event and "response" in lg_interrupt_meta_event:
            resume_input = Command(resume=lg_interrupt_meta_event["response"])

        mode = "continue" if thread_id and node_name != "__end__" and node_name is not None else "start"
        thread_id = thread_id or str(uuid.uuid4())
        config["configurable"]["thread_id"] = thread_id

        if mode == "continue" and not has_active_interrupts:
            await self.graph.aupdate_state(config, state, as_node=node_name)


        initial_state = state if mode == "start" else None

        # Use provided resume_input or fallback to initial_state
        stream_input = resume_input if resume_input else initial_state

        # Get the output and input schema keys the user has allowed for this graph
        input_keys, output_keys, config_keys = self.get_schema_keys(config)
        self.output_schema_keys = output_keys
        self.input_schema_keys = input_keys

        stream_input = self.filter_state_on_schema_keys(stream_input, 'input')
        config["configurable"] = filter_by_schema_keys(config["configurable"], config_keys)

        if has_active_interrupts and (not resume_input):
            value = active_interrupts[0].value
            return {
                "stream": None,
                "state": None,
                "config": None,
                "interrupt_event": self.get_interrupt_event(value),
            }

        return {
            "stream": self.graph.astream_events(stream_input, config, version="v2"),
            "state": current_graph_state,
            "config": config
        }

    async def prepare_regenerate_stream( # pylint: disable=too-many-arguments
            self,
            *,
            state: Any,
            config: Optional[dict] = None,
            actions: Optional[List[ActionDict]] = None,
            message_checkpoint: HumanMessage
    ):
        thread_id = config.get("configurable", {}).get("thread_id")
        time_travel_checkpoint = await self.get_checkpoint_before_message(message_checkpoint.id, thread_id)
        if time_travel_checkpoint is None:
            return None

        fork = await self.graph.aupdate_state(
            time_travel_checkpoint.config,
            time_travel_checkpoint.values,
            as_node=time_travel_checkpoint.next[0] if time_travel_checkpoint.next else "__start__"
        )

        stream_input = cast(Callable, self.merge_state)(
            state=time_travel_checkpoint.values,
            messages=[message_checkpoint],
            actions=actions,
            agent_name=self.name
        )
        stream = self.graph.astream_events(stream_input, fork, version="v2")
        return {
            "stream": stream,
            "state": state,
            "config": config
        }


    async def _stream_events( # pylint: disable=too-many-locals
            self,
            *,
            state: Any,
            config: Optional[dict] = None,
            messages: List[Message],
            thread_id: str,
            actions: Optional[List[ActionDict]] = None,
            node_name: Optional[str] = None,
            meta_events: Optional[List[MetaEvent]] = None,
        ):
        default_config = ensure_config(cast(Any, self.langgraph_config.copy()) if self.langgraph_config else {}) # pylint: disable=line-too-long
        config = {**default_config, **(self.graph.config or {}), **(config or {})}
        config["configurable"] = {**config.get("configurable", {}), **(config["configurable"] or {})}
        config["configurable"]["thread_id"] = thread_id

        streaming_state_extractor = _StreamingStateExtractor([])
        prev_node_name = None
        emit_intermediate_state_until_end = None
        should_exit = False
        manually_emitted_state = None
        thread_id = cast(Any, config)["configurable"]["thread_id"]

        agent_state = await self.graph.aget_state(config)
        prepared_stream_response = await self.prepare_stream(
            state_input=state,
            agent_state=agent_state,
            config=config,
            messages=messages,
            actions=actions,
            thread_id=thread_id,
            node_name=node_name,
            meta_events=meta_events
        )

        langchain_messages = self.convert_messages(messages)
        non_system_messages = [msg for msg in langchain_messages if not isinstance(msg, SystemMessage)]
        if len(agent_state.values.get("messages", [])) > len(non_system_messages):
            # Find the last user message by working backwards from the last message
            last_user_message = None
            for i in range(len(langchain_messages) - 1, -1, -1):
                if isinstance(langchain_messages[i], HumanMessage):
                    last_user_message = langchain_messages[i]
                    break

            if last_user_message:
                prepared_stream_response = await self.prepare_regenerate_stream(
                    state=state,
                    config=config,
                    message_checkpoint=last_user_message,
                    actions=actions,
                )

        state = prepared_stream_response["state"]
        current_graph_state = prepared_stream_response["state"]
        stream = prepared_stream_response["stream"]
        config = prepared_stream_response["config"]
        interrupt_event = prepared_stream_response.get('interrupt_event', None)

        if interrupt_event:
            yield interrupt_event
            return

        try:
            async for event in stream:
                current_node_name = event.get("name")
                event_type = event.get("event")
                run_id = event.get("run_id")
                metadata = event.get("metadata", {})

                interrupt_event = (
                    event["data"].get("chunk", {}).get("__interrupt__", None)
                    if (
                        isinstance(event.get("data"), dict) and
                        isinstance(event["data"].get("chunk"), dict)
                    )
                    else None
                )
                if interrupt_event:
                    value = interrupt_event[0].value
                    yield self.get_interrupt_event(value)
                    continue

                should_exit = should_exit or (
                    event_type == "on_custom_event" and
                    event["name"] == "copilotkit_exit"
                )

                # OPTIMIZATION: Update local state from chain_end events to avoid checkpointer calls
                if event_type == "on_chain_end" and isinstance(
                    event.get("data", {}).get("output"), dict
                ):
                    current_graph_state.update(event["data"]["output"])

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

                # OPTIMIZATION: Use locally maintained state instead of hitting checkpointer repeatedly
                updated_state = manually_emitted_state or current_graph_state

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
                    current_graph_state.update(updated_state)
                    yield self._emit_state_sync_event(
                        thread_id=thread_id,
                        run_id=run_id,
                        node_name=node_name,
                        state=state,
                        running=True,
                        active=not exiting_node
                    ) + "\n"

                yield langchain_dumps(event) + "\n"
        except Exception as error:
            # Emit error information through streaming protocol before terminating
            # This preserves the semantic error details that would otherwise be lost
            error_message = str(error)
            error_type = type(error).__name__

            # Extract additional error details for common error types
            error_details = {
                "message": error_message,
                "type": error_type,
                "agent_name": self.name,
            }

            # Add specific details for OpenAI errors
            if hasattr(error, 'status_code'):
                error_details["status_code"] = error.status_code
            if hasattr(error, 'response') and hasattr(error.response, 'json'):
                try:
                    error_details["response_data"] = error.response.json()
                except:
                    pass

            # Emit error events in both formats to support both LangGraph Platform and direct LangGraph modes

            # Format for LangGraph Platform (remote-lg-action.ts)
            yield langchain_dumps({
                "event": "error",
                "data": {
                    "message": f"{error_type}: {error_message}",
                    "error_details": error_details,
                    "thread_id": thread_id,
                    "agent_name": self.name,
                    "node_name": node_name or "unknown"
                }
            }) + "\n"

            # Format for direct LangGraph mode (event-source.ts)
            yield langchain_dumps({
                "event": "on_copilotkit_error",
                "data": {
                    "error": error_details,
                    "thread_id": thread_id,
                    "agent_name": self.name,
                    "node_name": node_name or "unknown"
                }
            }) + "\n"

            # Re-raise the exception to maintain normal error handling flow
            raise

        state = await self.graph.aget_state(config)
        tasks = state.tasks
        interrupts = tasks[0].interrupts if tasks and len(tasks) > 0 else None
        if interrupts:
            # node_name is already set earlier from the interrupt origin
            pass
        elif "writes" in state.metadata and state.metadata["writes"]:
            node_name = list(state.metadata["writes"].keys())[0]
        elif hasattr(state, "next") and state.next and state.next[0]:
            node_name = state.next[0]
        else:
            node_name = "__end__"
        is_end_node = state.next == () and not interrupts

        yield self._emit_state_sync_event(
            thread_id=thread_id,
            run_id=run_id,
            node_name=cast(str, node_name) if not is_end_node else "__end__",
            state=state.values,
            running=not should_exit,
            # at this point, the node is ending so we set active to false
            active=False,
            # sync messages at the end of the run
            include_messages=True
        ) + "\n"

    def _emit_state_sync_event(
        self,
        *,
        thread_id: str,
        run_id: str,
        node_name: str,
        state: dict,
        running: bool,
        active: bool,
        include_messages: bool = False
    ):
        # First handle messages as before
        if not include_messages:
            state = {
                k: v for k, v in state.items() if k != "messages"
            }
        else:
            state = {
                **state,
                "messages": langchain_messages_to_copilotkit(state.get("messages", []))
            }

        # Filter by schema keys if available
        state = self.filter_state_on_schema_keys(state, 'output')

        return langchain_dumps({
            "event": "on_copilotkit_state_sync",
            "thread_id": thread_id,
            "run_id": run_id,
            "agent_name": self.name,
            "node_name": node_name,
            "active": active,
            "state": state,
            "running": running,
            "role": "assistant"
        })

    async def get_state(
        self,
        *,
        thread_id: str,
    ):
        if not thread_id:
            return {
                "threadId": "",
                "threadExists": False,
                "state": {},
                "messages": []
            }

        config = ensure_config(cast(Any, self.langgraph_config.copy()) if self.langgraph_config else {}) # pylint: disable=line-too-long
        config["configurable"] = config.get("configurable", {})
        config["configurable"]["thread_id"] = thread_id

        if self.thread_state.get(thread_id, None) is None:
            self.thread_state[thread_id] = {**(await self.graph.aget_state(config)).values}

        state = self.thread_state[thread_id]
        if state == {}:
            return {
                "threadId": thread_id or "",
                "threadExists": False,
                "state": {},
                "messages": []
            }

        messages = langchain_messages_to_copilotkit(state.get("messages", []))
        state_copy = state.copy()
        state_copy.pop("messages", None)

        return {
            "threadId": thread_id,
            "threadExists": True,
            "state": state_copy,
            "messages": messages
        }

    def dict_repr(self):
        super_repr = super().dict_repr()
        return {
            **super_repr,
            'type': 'langgraph'
        }

    def get_schema_keys(self, config):
        CONSTANT_KEYS = ['copilotkit', 'messages']
        CONSTANT_CONFIG_KEYS = ['checkpoint_id', 'checkpoint_ns', 'thread_id']
        try:
            input_schema = self.graph.get_input_jsonschema(config)
            output_schema = self.graph.get_output_jsonschema(config)
            input_schema_keys = list(input_schema["properties"].keys())
            output_schema_keys = list(output_schema["properties"].keys())

            try:
                schema_dict = self.graph.config_schema().schema()
                configurable_schema = schema_dict["$defs"]["Configurable"]
                config_schema_keys = list(configurable_schema["properties"].keys())

                # If only constant keys are present, it means no schema was passed, we allow everything
                if set(config_schema_keys) == set(CONSTANT_CONFIG_KEYS):
                    config_schema_keys = None
            except:
                config_schema_keys = None

            # We add "copilotkit" and "messages" as they are always sent and received.
            for key in CONSTANT_KEYS:
                if key not in input_schema_keys:
                    input_schema_keys.append(key)
                if key not in output_schema_keys:
                    output_schema_keys.append(key)

            return input_schema_keys, output_schema_keys, config_schema_keys
        except Exception:
            return None

    def filter_state_on_schema_keys(self, state, schema_type: Literal["input", "output"]):
        try:
            schema_keys_name = f"{schema_type}_schema_keys"
            if hasattr(self, schema_keys_name) and getattr(self, schema_keys_name):
                return filter_by_schema_keys(state, getattr(self, schema_keys_name))
        except Exception:
            return state

    def get_interrupt_event(self, value):
        if not isinstance(value, str) and "__copilotkit_interrupt_value__" in value:
            ev_value = value["__copilotkit_interrupt_value__"]
            return langchain_dumps({
                "event": "on_copilotkit_interrupt",
                "data": { "value": ev_value if isinstance(ev_value, str) else json.dumps(ev_value), "messages": langchain_messages_to_copilotkit(value["__copilotkit_messages__"]) }
            }) + "\n"
        else:
            return langchain_dumps({
                "event": "on_interrupt",
                "value": value if isinstance(value, str) else json.dumps(value)
            }) + "\n"

    async def get_checkpoint_before_message(self, message_id: str, thread_id: str):
        if not thread_id:
            raise ValueError("Missing thread_id in config")

        history_list = []
        async for snapshot in self.graph.aget_state_history({"configurable": {"thread_id": thread_id}}):
            history_list.append(snapshot)

        history_list.reverse()
        for idx, snapshot in enumerate(history_list):
            messages = snapshot.values.get("messages", [])
            if any(getattr(m, "id", None) == message_id for m in messages):
                if idx == 0:
                    # No snapshot before this
                    # Return synthetic "empty before" version
                    empty_snapshot = snapshot
                    empty_snapshot.values["messages"] = []
                    return empty_snapshot
                return history_list[idx - 1]  # return one snapshot *before* the one that includes the message

        raise ValueError("Message ID not found in history")

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
