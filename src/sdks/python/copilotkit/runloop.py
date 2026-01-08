"""
CopilotKit Run Loop
"""

import asyncio
import contextvars
import json
import traceback
from typing import Callable
from pydantic import BaseModel
from typing_extensions import Any, Dict, Optional, List, TypedDict, cast
from partialjson.json_parser import JSONParser as PartialJSONParser

from .protocol import (
    RuntimeEvent,
    RuntimeEventTypes,
    RuntimeMetaEventName,
    emit_runtime_event,
    emit_runtime_events,
    agent_state_message,
    AgentStateMessage,
    PredictStateConfig,
    RuntimeProtocolEvent
)

async def yield_control():
    """
    Yield control to the event loop.
    """
    loop = asyncio.get_running_loop()
    future = loop.create_future()
    loop.call_soon(future.set_result, None)
    await future


class CopilotKitRunExecution(TypedDict):
    """
    CopilotKit Run Execution
    """
    thread_id: str
    agent_name: str
    run_id: str
    should_exit: bool
    node_name: str
    is_finished: bool
    predict_state_configuration: Dict[str, PredictStateConfig]
    predicted_state: Dict[str, Any]
    argument_buffer: str
    current_tool_call: Optional[str]
    state: Dict[str, Any]

_CONTEXT_QUEUE = contextvars.ContextVar('queue', default=None)
_CONTEXT_EXECUTION = contextvars.ContextVar('execution', default=None)

def get_context_queue() -> asyncio.Queue:
    """
    Retrieve the queue from this task's context.
    """
    q = _CONTEXT_QUEUE.get()
    if q is None:
        raise RuntimeError("No context queue is set!")
    return q

def set_context_queue(q: asyncio.Queue) -> contextvars.Token:
    """
    Set the queue in this task's context.
    """
    token = _CONTEXT_QUEUE.set(cast(Any, q))
    return token

def reset_context_queue(token: contextvars.Token):
    """
    Reset the queue in this task's context.
    """
    _CONTEXT_QUEUE.reset(token)

def get_context_execution() -> CopilotKitRunExecution:
    """
    Get the execution from this task's context.
    """
    return cast(CopilotKitRunExecution, _CONTEXT_EXECUTION.get())

def set_context_execution(execution: CopilotKitRunExecution) -> contextvars.Token:
    """
    Set the execution in this task's context.
    """
    token = _CONTEXT_EXECUTION.set(cast(Any, execution))
    return token

def reset_context_execution(token: contextvars.Token):
    """
    Reset the execution in this task's context.
    """
    _CONTEXT_EXECUTION.reset(token)


async def queue_put(*events: RuntimeEvent, priority: bool = False):
    """
    Put an event in the queue.
    """
    if not priority:
        # yield control so that priority events can be processed first
        await yield_control()

    q = get_context_queue()
    for event in events:
        await q.put(event)

    # yield control so that the reader can process the event
    await yield_control()


def _to_dict_if_pydantic(obj):
    if isinstance(obj, BaseModel):
        return obj.model_dump()
    return obj

def _filter_state(
        *,
        state: Dict[str, Any],
        exclude_keys: Optional[List[str]] = None
    ) -> Dict[str, Any]:
    """Filter out messages and id from the state"""
    state = _to_dict_if_pydantic(state)
    exclude_keys = exclude_keys or ["messages", "id"]
    return {k: v for k, v in state.items() if k not in exclude_keys}


async def copilotkit_run(
        fn: Callable,
        *,
        execution: CopilotKitRunExecution
):
    """
    Run a task with a local queue.
    """
    local_queue = asyncio.Queue()
    token_queue = set_context_queue(local_queue)
    token_execution = set_context_execution(execution)

    task = asyncio.create_task(
        fn()
    )
    try:
        while True:
            event = await local_queue.get()
            local_queue.task_done()

            json_lines = handle_runtime_event(
                event=event,
                execution=execution
            )

            if json_lines is not None:
                yield json_lines

            if execution["is_finished"]:
                break

            # return control to the containing run loop to send events
            await yield_control()

        await task

    finally:
        reset_context_queue(token_queue)
        reset_context_execution(token_execution)

def handle_runtime_event(
        *,
        event: RuntimeEvent,
        execution: CopilotKitRunExecution
) -> Optional[str]:
    """
    Handle a runtime event.
    """

    if event["type"] in [
        RuntimeEventTypes.TEXT_MESSAGE_START,
        RuntimeEventTypes.TEXT_MESSAGE_CONTENT,
        RuntimeEventTypes.TEXT_MESSAGE_END,
        RuntimeEventTypes.ACTION_EXECUTION_START,
        RuntimeEventTypes.ACTION_EXECUTION_ARGS,
        RuntimeEventTypes.ACTION_EXECUTION_END,
        RuntimeEventTypes.ACTION_EXECUTION_RESULT,
        RuntimeEventTypes.AGENT_STATE_MESSAGE
    ]:
        events: List[RuntimeProtocolEvent] = [cast(RuntimeProtocolEvent, event)]
        if event["type"] in [
            RuntimeEventTypes.ACTION_EXECUTION_START,
            RuntimeEventTypes.ACTION_EXECUTION_ARGS
        ]:
            message = predict_state(
                thread_id=execution["thread_id"],
                agent_name=execution["agent_name"],
                run_id=execution["run_id"],
                event=event,
                execution=execution,
            )
            if message is not None:
                events.append(message)
        return emit_runtime_events(*events)

    if event["type"] == RuntimeEventTypes.META_EVENT:
        if event["name"] == RuntimeMetaEventName.PREDICT_STATE:
            execution["predict_state_configuration"] = event["value"]
            return None
        if event["name"] == RuntimeMetaEventName.EXIT:
            execution["should_exit"] = event["value"]
            return None
        return None

    if event["type"] == RuntimeEventTypes.RUN_STARTED:
        execution["state"] = event["state"]
        return None

    if event["type"] == RuntimeEventTypes.NODE_STARTED:
        execution["node_name"] = event["node_name"]
        execution["state"] = event["state"]

        return emit_runtime_event(
            agent_state_message(
                thread_id=execution["thread_id"],
                agent_name=execution["agent_name"],
                node_name=execution["node_name"],
                run_id=execution["run_id"],
                active=True,
                role="assistant",
                state=json.dumps(_filter_state(state=execution["state"])),
                running=True
            )
        )

    if event["type"] == RuntimeEventTypes.NODE_FINISHED:

        # reset the predict state configuration at the end of the method execution
        execution["predict_state_configuration"] = {}
        execution["current_tool_call"] = None
        execution["argument_buffer"] = ""
        execution["predicted_state"] = {}
        execution["state"] = event["state"]

        return emit_runtime_event(
            agent_state_message(
                thread_id=execution["thread_id"],
                agent_name=execution["agent_name"],
                node_name=execution["node_name"],
                run_id=execution["run_id"],
                active=False,
                role="assistant",
                state=json.dumps(_filter_state(state=execution["state"])),
                running=True
            )
        )

    if event["type"] == RuntimeEventTypes.RUN_FINISHED:
        execution["is_finished"] = True
        return None

    if event["type"] == RuntimeEventTypes.RUN_ERROR:
        print("Flow execution error", flush=True)
        error_info = event["error"]

        if isinstance(error_info, Exception):
            # If it's an exception, print the traceback
            print("Exception occurred:", flush=True)
            print(
                ''.join(
                    traceback.format_exception(
                        None,
                        error_info,
                        error_info.__traceback__
                    )
                ),
                flush=True
            )
        else:
            # Otherwise, assume it's a string and print it
            print(error_info, flush=True)

        execution["is_finished"] = True
        return None

def predict_state(
        *,
        thread_id: str,
        agent_name: str,
        run_id: str,
        event: Any,
        execution: CopilotKitRunExecution,
) -> Optional[AgentStateMessage]:
    """Predict the state"""
    
    if event["type"] == RuntimeEventTypes.ACTION_EXECUTION_START:
        execution["current_tool_call"] = event["actionName"]
        execution["argument_buffer"] = ""
    elif event["type"] == RuntimeEventTypes.ACTION_EXECUTION_ARGS:
        execution["argument_buffer"] += event["args"]

        tool_names = [
            config.get("tool_name")
            for config in execution["predict_state_configuration"].values()
        ]

        if execution["current_tool_call"] not in tool_names:
            return None

        current_arguments = {}
        try:
            current_arguments = PartialJSONParser().parse(execution["argument_buffer"])
        except:  # pylint: disable=bare-except
            return None

        emit_update = False
        for k, v in execution["predict_state_configuration"].items():
            if v["tool_name"] == execution["current_tool_call"]:
                tool_argument = v.get("tool_argument")
                if tool_argument is not None:
                    argument_value = current_arguments.get(tool_argument)
                    if argument_value is not None:
                        execution["predicted_state"][k] = argument_value
                        emit_update = True
                else:
                    execution["predicted_state"][k] = current_arguments
                    emit_update = True

        if emit_update:
            return agent_state_message(
                thread_id=thread_id,
                agent_name=agent_name,
                node_name=execution["node_name"],
                run_id=run_id,
                active=True,
                role="assistant",
                state=json.dumps(
                    _filter_state(
                        state={
                            **(
                                execution["state"].model_dump()
                                if isinstance(execution["state"], BaseModel)
                                else execution["state"]
                            ),
                            **execution["predicted_state"]
                        }
                    )
                ),
                running=True
            )

        return None
