"""Copy explicit board edits into the current native session before invocation."""

from collections.abc import AsyncIterator, Mapping
from contextlib import aclosing
from typing import Any

from strands.hooks import BeforeInvocationEvent, HookProvider, HookRegistry

from tools.todos import manage_todos_impl

_TODOS = "showcase_board_todos"


class TodoStateHook(HookProvider):
    def register_hooks(self, registry: HookRegistry, **kwargs: Any) -> None:
        registry.add_callback(BeforeInvocationEvent, self.sync)

    def sync(self, event: BeforeInvocationEvent) -> None:
        if _TODOS in event.invocation_state:
            event.agent.state.set("todos", event.invocation_state[_TODOS])


class TodoStateAgent:
    """Forward request-local state through the adapter's invocation-state API.

    The hook runs after the native session has been restored. A missing todos
    key keeps that saved list; an explicit empty list means the board was cleared.
    Never keep this payload in a global or per-thread cache.
    """

    def __init__(self, delegate: Any) -> None:
        self._delegate = delegate

    def __getattr__(self, name: str) -> Any:
        return getattr(self._delegate, name)

    async def run(self, input_data: Any) -> AsyncIterator[Any]:
        state = input_data.state
        invocation_state = {}
        if isinstance(state, Mapping) and isinstance(state.get("todos"), list):
            invocation_state[_TODOS] = manage_todos_impl(state["todos"])
        async with aclosing(
            self._delegate.run(input_data, invocation_state=invocation_state)
        ) as events:
            async for event in events:
                yield event
