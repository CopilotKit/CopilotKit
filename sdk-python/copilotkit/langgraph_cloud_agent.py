# """LangGraph agent for CopilotKit"""

# from typing import Optional, List, Callable, Any, cast
# import uuid
# from langchain.load.dump import dumps as langchain_dumps
# from langchain.schema import BaseMessage, SystemMessage
# from langgraph_sdk import get_client

# from partialjson.json_parser import JSONParser

# from .types import Message
# from .langchain import copilotkit_messages_to_langchain
# from .action import ActionDict
# from .agent import Agent

# def langgraph_default_merge_state( # pylint: disable=unused-argument
#         *,
#         state: dict,
#         messages: List[BaseMessage],
#         actions: List[Any]
#     ):
#     """Default merge state for LangGraph"""
#     if len(messages) > 0 and isinstance(messages[0], SystemMessage):
#         # remove system message
#         messages = messages[1:]

#     # merge with existing messages
#     merged_messages = state.get("messages", [])
#     existing_message_ids = {message.id for message in merged_messages}

#     for message in messages:
#         if message.id not in existing_message_ids:
#             merged_messages.append(message)

#     return {
#         **state,
#         "messages": merged_messages,
#         "copilotkit": {
#             "actions": actions
#         }
#     }

# class LangGraphCloudAgent(Agent):
#     """LangGraph agent class for CopilotKit"""
#     def __init__(
#             self,
#             *,
#             name: str,
#             description: Optional[str] = None,
#             assistant_id: Optional[str] = None,
#             merge_state: Optional[Callable] = langgraph_default_merge_state
#         ):
#         super().__init__(
#             name=name,
#             description=description,
#             merge_state=merge_state
#         )
#         self.assistant_id = assistant_id or name

#     def _emit_state_sync_event(
#             self,
#             *,
#             thread_id: str,
#             run_id: str,
#             node_name: str,
#             state: dict,
#             running: bool,
#             active: bool
#         ):
#         state_without_messages = {
#             k: v for k, v in state.items() if k != "messages"
#         }
#         return langchain_dumps({
#             "event": "on_copilotkit_state_sync",
#             "thread_id": thread_id,
#             "run_id": run_id,
#             "agent_name": self.name,
#             "node_name": node_name,
#             "active": active,
#             "state": state_without_messages,
#             "running": running,
#             "role": "assistant"
#         })

#     def execute( # pylint: disable=too-many-arguments
#         self,
#         *,
#         state: dict,
#         messages: List[Message],
#         thread_id: Optional[str] = None,
#         node_name: Optional[str] = None,
#         actions: Optional[List[ActionDict]] = None,
#     ):
#         return self._stream_events(
#             messages=messages,
#             state=state,
#             thread_id=thread_id,
#             node_name=node_name,
#             actions=actions
#         )

#     async def _stream_events(
#             self,
#             *,
#             state: dict,
#             messages: List[Message],
#             thread_id: Optional[str] = None,
#             node_name: Optional[str] = None,
#             actions: Optional[List[ActionDict]] = None,
#         ):

#         client = get_client()
#         agent_state = {}
#         if thread_id:
#             agent_state = await client.threads.get_state(
#                 thread_id=thread_id,
#         )

#         state["messages"] = agent_state.get("values", {}).get("messages", [])

#         langchain_messages = copilotkit_messages_to_langchain(messages)
#         state = cast(Callable, self.merge_state)(
#             state=state,
#             messages=langchain_messages,
#             actions=actions
#         )

#         mode = "continue" if thread_id and node_name != "__end__" else "start"
#         thread_id = thread_id or str(uuid.uuid4())

#         if mode == "continue":
#             await client.threads.update_state(
#                 thread_id=thread_id,
#                 values=state,
#                 as_node=node_name
#             )

#         streaming_state_extractor = _StreamingStateExtractor([])
#         initial_state = state if mode == "start" else None
#         prev_node_name = None
#         emit_intermediate_state_until_end = None
#         should_exit = False

#         graph_info = await client.assistants.get_graph(
#             assistant_id=self.assistant_id
#         )

#         async for event in client.runs.stream(
#             thread_id,
#             self.assistant_id,
#             input=initial_state,
#             stream_mode="values"
#         ):
#             current_node_name = event.get("name")
#             event_type = event.get("event")
#             run_id = event.get("run_id")
#             tags = event.get("tags", [])
#             metadata = event.get("metadata", {})

#             should_exit = should_exit or "copilotkit:exit" in tags

#             emit_intermediate_state = metadata.get("copilotkit:emit-intermediate-state")
#             force_emit_intermediate_state = "copilotkit:force-emit-intermediate-state" in tags

#             # we only want to update the node name under certain conditions
#             # since we don't need any internal node names to be sent to the frontend
#             if current_node_name in {node["id"]: node for node in graph_info["nodes"]}:
#                 node_name = current_node_name

#             # we don't have a node name yet, so we can't update the state
#             if node_name is None:
#                 continue

#             exiting_node = node_name == current_node_name and event_type == "on_chain_end"

#             if force_emit_intermediate_state:
#                 if event_type == "on_chain_end":
#                     state = cast(Any, event["data"])["output"]
#                     yield self._emit_state_sync_event(
#                         thread_id=thread_id,
#                         run_id=run_id,
#                         node_name=node_name,
#                         state=state,
#                         running=True,
#                         active=True
#                     ) + "\n"
#                 continue

#             if emit_intermediate_state and emit_intermediate_state_until_end is None:
#                 emit_intermediate_state_until_end = node_name

#             if emit_intermediate_state and event_type == "on_chat_model_start":
#                 # reset the streaming state extractor
#                 streaming_state_extractor = _StreamingStateExtractor(emit_intermediate_state)

#             updated_state = await client.threads.get_state(thread_id=thread_id)["values"]

#             if emit_intermediate_state and event_type == "on_chat_model_stream":
#                 streaming_state_extractor.buffer_tool_calls(event)

#             if emit_intermediate_state_until_end is not None:
#                 updated_state = {
#                     **updated_state,
#                     **streaming_state_extractor.extract_state()
#                 }

#             if (not emit_intermediate_state and
#                 current_node_name == emit_intermediate_state_until_end and 
#                 event_type == "on_chain_end"):
#                 # stop emitting function call state
#                 emit_intermediate_state_until_end = None

#             # we send state sync events when:
#             #   a) the state has changed
#             #   b) the node has changed
#             #   c) the node is ending
#             if updated_state != state or prev_node_name != node_name or exiting_node:
#                 state = updated_state
#                 prev_node_name = node_name
#                 yield self._emit_state_sync_event(
#                     thread_id=thread_id,
#                     run_id=run_id,
#                     node_name=node_name,
#                     state=state,
#                     running=True,
#                     active=not exiting_node
#                 ) + "\n"

#             yield langchain_dumps(event) + "\n"

#         state = await client.threads.get_state(thread_id=thread_id)
#         is_end_node = state["next"] == ()

#         node_name = list(state["metadata"]["writes"].keys())[0]

#         yield self._emit_state_sync_event(
#             thread_id=thread_id,
#             run_id=run_id,
#             node_name=cast(str, node_name) if not is_end_node else "__end__",
#             state=state["values"],
#             running=not should_exit,
#             # at this point, the node is ending so we set active to false
#             active=False
#         ) + "\n"



#     def dict_repr(self):
#         super_repr = super().dict_repr()
#         return {
#             **super_repr,
#             'type': 'langgraph'
#         }

# class _StreamingStateExtractor:
#     def __init__(self, emit_intermediate_state: List[dict]):
#         self.emit_intermediate_state = emit_intermediate_state
#         self.tool_call_buffer = {}
#         self.current_tool_call = None

#         self.previously_parsable_state = {}

#     def buffer_tool_calls(self, event: Any):
#         """Buffer the tool calls"""
#         if len(event["data"]["chunk"].tool_call_chunks) > 0:
#             chunk = event["data"]["chunk"].tool_call_chunks[0]
#             if chunk["name"] is not None:
#                 self.current_tool_call = chunk["name"]
#                 self.tool_call_buffer[self.current_tool_call] = chunk["args"]
#             elif self.current_tool_call is not None:
#                 self.tool_call_buffer[self.current_tool_call] = (
#                     self.tool_call_buffer[self.current_tool_call] + chunk["args"]
#                 )

#     def get_emit_state_config(self, current_tool_name):
#         """Get the emit state config"""

#         for config in self.emit_intermediate_state:
#             state_key = config.get("state_key")
#             tool = config.get("tool")
#             tool_argument = config.get("tool_argument")

#             if current_tool_name == tool:
#                 return (tool_argument, state_key)

#         return (None, None)


#     def extract_state(self):
#         """Extract the streaming state"""
#         parser = JSONParser()

#         state = {}

#         for key, value in self.tool_call_buffer.items():
#             argument_name, state_key = self.get_emit_state_config(key)

#             if state_key is None:
#                 continue

#             try:
#                 parsed_value = parser.parse(value)
#             except Exception as _exc: # pylint: disable=broad-except
#                 if key in self.previously_parsable_state:
#                     parsed_value = self.previously_parsable_state[key]
#                 else:
#                     continue

#             self.previously_parsable_state[key] = parsed_value

#             if argument_name is None:
#                 state[state_key] = parsed_value
#             else:
#                 state[state_key] = parsed_value.get(argument_name)

#         return state
