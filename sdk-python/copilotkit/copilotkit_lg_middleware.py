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
from typing import Any, Callable, Awaitable, ClassVar, Iterable, Optional, Union

from langchain_core.messages import AIMessage, SystemMessage, ToolMessage
from langchain.agents.middleware import (
    AgentMiddleware,
    AgentState,
    ModelRequest,
    ModelResponse,
)
from langgraph.runtime import Runtime

from .header_propagation import install_httpx_hook, set_forwarded_headers
from .langgraph import CopilotKitProperties

# Optional dependency: the A2UI subagent-tool factory ships in ag-ui-langgraph.
# Guarded so an older/skewed version without the factory degrades to
# "no auto-A2UI" instead of breaking the whole middleware import.
try:  # pragma: no cover - exercised indirectly via the a2ui injection path
    from ag_ui_langgraph import get_a2ui_tools, A2UIToolParams
except Exception:  # noqa: BLE001 - any import failure means the feature is off
    get_a2ui_tools = None
    A2UIToolParams = None

# Track which httpx clients already have the header-propagation hook installed
# (by object id) so we never double-install on repeated model calls.
_hooked_clients: set[int] = set()

# ---------------------------------------------------------------------------
# Auto-A2UI: bridge the inferred model from the model-call hook to the
# tool-call hook
# ---------------------------------------------------------------------------
# The generate_a2ui tool drives a structured-output subagent and so needs a
# chat model. We "infer" that model from ``request.model`` in
# ``wrap_model_call`` (the only hook that exposes the bound model) and reuse it.
# But the tool actually *executes* later in ``wrap_tool_call``, whose request
# does NOT carry the model. ContextVars do not reliably survive LangGraph node
# boundaries, so we bridge the built tool across nodes via a module-level map
# keyed by the run's thread id.
_a2ui_tools_by_thread: dict[str, Any] = {}

# Fallback key for runs without a thread id (e.g. an in-memory invoke with no
# checkpointer). Collisions across concurrent context-less runs are an
# acceptable edge — the deployed path always carries a thread id.
_DEFAULT_THREAD_KEY = "__copilotkit_a2ui_default__"


def _current_thread_id() -> "str | None":
    """Best-effort read of the active run's thread id from the LangGraph config.

    Returns ``None`` outside a runnable context (e.g. unit tests); callers then
    fall back to ``_DEFAULT_THREAD_KEY``.
    """
    try:
        from langgraph.config import get_config

        cfg = get_config() or {}
        return (cfg.get("configurable") or {}).get("thread_id")
    except Exception:  # noqa: BLE001 - no active context / older langgraph
        return None


def _extract_forwarded_headers_from_config() -> None:
    """Extract raw ``x-*`` headers from the current LangGraph RunnableConfig and
    push them into the header-propagation ContextVar so the httpx hook can
    forward them on outgoing LLM requests.

    When an agent runs inside **langgraph-api** with
    ``LANGGRAPH_HTTP={"configurable_headers":{"include":["x-*"]}}``,
    the server copies inbound HTTP ``x-*`` headers into
    ``config["configurable"]`` as individual keys (e.g.
    ``configurable["x-aimock-context"] = "value"``).  This function reads those
    keys and calls :func:`set_forwarded_headers` so they propagate to the
    underlying LLM provider SDK via the httpx event hook.

    Precedence: the wrapper dict ``copilotkit_forwarded_headers`` (if present)
    takes priority over raw ``x-*`` keys.  Raw keys are only used when the
    wrapper dict is absent or does not contain a given header.

    Safe to call outside a runnable context (e.g. in unit tests) — silently
    returns without doing anything if ``get_config()`` raises.
    """
    try:
        from langgraph.config import (
            get_config,
        )  # local import to avoid hard dep at module level

        config = get_config()
    except ImportError:
        return
    except RuntimeError:
        # No active runnable context — clear the ContextVar so stale headers
        # from a prior request in the same async context do not leak through.
        set_forwarded_headers({})
        return

    try:
        headers: dict[str, str] = {}

        # Sources to scan: config["context"] (LangGraph >=0.6.0) and
        # config["configurable"] (all versions).
        context = config.get("context") or {}
        configurable = config.get("configurable") or {}

        # 1) Wrapper-dict path (highest priority): these are headers that
        #    CopilotKit explicitly bundled under a known key.  Process context
        #    first with first-write-wins so context takes precedence over
        #    configurable (LangGraph >=0.6.0 introduced context as the newer
        #    preferred mechanism).
        for src in (context, configurable):
            if not isinstance(src, dict):
                continue
            wrapper = src.get("copilotkit_forwarded_headers")
            if isinstance(wrapper, dict):
                for k, v in wrapper.items():
                    lk = k.lower() if isinstance(k, str) else k
                    if isinstance(k, str) and isinstance(v, str) and lk not in headers:
                        headers[lk] = v

        # 2) Raw x-* keys directly on context and configurable.  These appear
        #    when langgraph-api's configurable_headers mechanism forwards inbound
        #    HTTP headers as individual configurable entries.
        for src in (context, configurable):
            if not isinstance(src, dict):
                continue
            for k, v in src.items():
                if (
                    isinstance(k, str)
                    and k.lower().startswith("x-")
                    and isinstance(v, str)
                ):
                    # Don't overwrite wrapper-dict values (wrapper > raw).
                    # Lowercase at insertion so precedence checks are
                    # deterministic regardless of source casing.
                    lk = k.lower()
                    if lk not in headers:
                        headers[lk] = v

        # Always set the ContextVar — even with an empty dict — so stale
        # headers from previous calls in the same async context do not leak
        # into this one.
        set_forwarded_headers(headers)
    except Exception as e:
        # Header forwarding is best-effort.  Never block the LLM call.
        # Clear the ContextVar so stale headers from a prior request do not
        # leak through on failure.
        set_forwarded_headers({})
        import logging

        logging.getLogger(__name__).debug(
            "Header forwarding extraction failed; continuing without forwarded headers: %s",
            e,
        )


def _ensure_httpx_hook(model: Any) -> None:
    """Install the header-propagation httpx hook on a LangChain chat model's
    underlying HTTP client(s), if present.  No-op for models that don't expose
    an httpx transport (e.g. non-OpenAI/Anthropic providers).
    """
    for attr in ("client", "async_client"):
        client = getattr(model, attr, None)
        if client is None:
            continue
        cid = id(client)
        if cid not in _hooked_clients:
            install_httpx_hook(client)
            _hooked_clients.add(cid)


class StateSchema(AgentState):
    copilotkit: CopilotKitProperties


StateSchema.__annotations__["ag-ui"] = CopilotKitProperties


# Internal/framework keys that should never be surfaced to the LLM as
# user-facing state. These are either reducer-managed message buckets,
# CopilotKit/AG-UI plumbing, or graph-internal scaffolding.
_RESERVED_STATE_KEYS = frozenset(
    {
        "messages",
        "copilotkit",
        # Transport-layer plumbing: forwarded request headers conveyed via a
        # separate ContextVar to the httpx hook. MUST never be rendered into
        # the LLM prompt — neither via App Context nor via expose_state.
        "copilotkit_forwarded_headers",
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
        a2ui_params: Optional host overrides for the auto-injected
            ``generate_a2ui`` tool, forwarded to ``get_a2ui_tools`` when A2UI
            injection fires. An ``A2UIToolParams``-shaped dict: ``guidelines``
            (``generation_guidelines`` / ``design_guidelines`` /
            ``composition_guide``), ``default_catalog_id``,
            ``default_surface_id``, ``tool_name``, ``recovery``, etc. Lets a
            host steer the subagent (e.g. override the default design
            guidelines to favor a repeating-card layout) on the auto-inject
            path, which otherwise only ever uses the toolkit defaults.

            The middleware always injects ``model`` from the bound request
            model (the host cannot supply the live, header-hooked model), and
            folds the registered catalog id + component schema into the params
            unless the host already set them — so host values win.
    """

    state_schema = StateSchema
    tools: ClassVar[list] = []

    def __init__(
        self,
        *,
        expose_state: Union[bool, Iterable[str]] = False,
        a2ui_params: "Optional[A2UIToolParams]" = None,
    ):
        super().__init__()
        if isinstance(expose_state, bool):
            self._expose_state: Union[bool, frozenset[str]] = expose_state
        else:
            self._expose_state = frozenset(expose_state)
        # Host-supplied A2UI tool overrides (guidelines, catalog id, tool name,
        # recovery, ...). Copied so later mutation of the caller's dict can't
        # bleed into the middleware. ``model`` + the registered catalog are
        # layered in at build time; everything here is host-owned and wins.
        self._a2ui_params: dict = dict(a2ui_params or {})

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
            # Allowlist branch: honor user intent for other reserved keys
            # (e.g. ``thread_id``) so the override test in this suite still
            # passes, but hard-exclude ``copilotkit_forwarded_headers`` —
            # rendering it would leak the raw forwarded request headers into
            # the LLM prompt, which is what the reserved-keys comment above
            # promises will never happen "via App Context nor via expose_state".
            keys: list[str] = [
                k
                for k in self._expose_state
                if k in state and k != "copilotkit_forwarded_headers"
            ]
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

    def _build_app_context_note(
        self,
        state: dict[str, Any],
        runtime_context: Any = None,
    ) -> str | None:
        copilotkit_state = state.get("copilotkit", {})
        app_context = copilotkit_state.get("context") or runtime_context

        if isinstance(app_context, dict):
            app_context = {
                k: v
                for k, v in app_context.items()
                if k != "copilotkit_forwarded_headers"
            }

        if not app_context:
            return None
        if isinstance(app_context, str) and app_context.strip() == "":
            return None
        if isinstance(app_context, dict) and len(app_context) == 0:
            return None

        if isinstance(app_context, str):
            context_content = app_context
        else:
            if hasattr(app_context, "model_dump"):
                app_context = app_context.model_dump()
            elif isinstance(app_context, list):
                app_context = [
                    item.model_dump() if hasattr(item, "model_dump") else item
                    for item in app_context
                ]
            context_content = json.dumps(app_context, indent=2)

        return f"App Context:\n{context_content}"

    def _apply_app_context_note(self, request: ModelRequest) -> ModelRequest:
        note = self._build_app_context_note(
            request.state or {},
            getattr(request.runtime, "context", None),
        )
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

    # ------------------------------------------------------------------
    # Auto-A2UI tool injection
    # ------------------------------------------------------------------

    @staticmethod
    def _resolve_a2ui_catalog(state: dict) -> "tuple[str | None, str | None] | None":
        """Find the frontend-registered A2UI catalog wherever it was passed.

        Returns ``(component_schema, catalog_id)`` when a catalog is present,
        else ``None`` (so the tool is never advertised when the client can't
        render A2UI). Two delivery paths are supported, because the catalog
        lands in different places depending on how the agent is served:

        - **AG-UI native endpoint** → ``state["ag-ui"]["a2ui_schema"]``, a JSON
          string ``{"catalogId": ..., "components": [...]}``.
        - **CopilotKit runtime proxy** → a ``state["copilotkit"]["context"]``
          entry describing the A2UI catalog (catalog id + component schemas as
          text).

        ``component_schema`` is the text/JSON the subagent should compose from;
        ``catalog_id`` binds generated surfaces to the frontend's catalog (so
        BYOC custom catalogs render their own components, not the basic one).
        """
        # AG-UI native path.
        ag_ui = state.get("ag-ui") or state.get("ag_ui") or {}
        a2ui_schema = ag_ui.get("a2ui_schema")
        if a2ui_schema:
            catalog_id = None
            try:
                parsed = (
                    json.loads(a2ui_schema)
                    if isinstance(a2ui_schema, str)
                    else a2ui_schema
                )
                if isinstance(parsed, dict):
                    catalog_id = parsed.get("catalogId")
            except (TypeError, ValueError):
                pass
            # Native path: the toolkit reads ``a2ui_schema`` from state itself,
            # so no composition_guide is needed — just surface the catalog id.
            return None, catalog_id

        # CopilotKit runtime-proxy path: the catalog arrives as a context entry.
        context = (state.get("copilotkit") or {}).get("context") or []
        for entry in context:
            if not isinstance(entry, dict):
                continue
            description = entry.get("description") or ""
            value = entry.get("value") or ""
            if "A2UI catalog" not in description or not value:
                continue
            # The value lists catalogs as "- <catalogId>" lines; the first is
            # the custom catalog the client registered.
            match = re.search(r"(?m)^\s*-\s+(\S+)", value)
            catalog_id = match.group(1) if match else None
            return value, catalog_id

        return None

    @staticmethod
    def _a2ui_inject_decision(state: dict) -> "bool | str | None":
        """Return the A2UI ``injectA2UITool`` decision, or ``None``.

        The ``@ag-ui/a2ui-middleware`` forwards its ``injectA2UITool`` setting on
        ``forwardedProps``, which ``ag-ui-langgraph`` surfaces into agent state at
        ``state["ag-ui"]["inject_a2ui_tool"]`` — present only when the host turned
        the runtime A2UI tool on (truthy or a custom tool-name string). ``None``
        means no signal at all (off, or no A2UI middleware in the pipeline), in
        which case we do not auto-inject.
        """
        return (state.get("ag-ui") or state.get("ag_ui") or {}).get("inject_a2ui_tool")

    def _maybe_build_a2ui_tool(self, request: ModelRequest) -> Any | None:
        """Build a ``generate_a2ui`` tool bound to the agent's own model when
        A2UI tool injection is turned on for this run.

        Gating, in order:

        1. **Opt-in.** Only inject when the A2UI ``injectA2UITool`` flag is
           truthy (forwarded by ``@ag-ui/a2ui-middleware`` and surfaced at
           ``state["ag-ui"]["inject_a2ui_tool"]``). No flag → no injection. This
           is the whole contract: "no injectA2UITool, no A2UI tool injection."
        2. **No double-inject.** If the agent already exposes a tool with the
           same name (e.g. a backend-defined ``generate_a2ui``), don't inject —
           the host owns it, and a duplicate would show the model two tools with
           one name.

        The model is inferred from ``request.model`` (the bound agent model); the
        component schema and catalog id come from the registered catalog (when
        present) so the subagent composes the right components and surfaces bind
        to the frontend's catalog — otherwise the toolkit's basic catalog is
        used. The built tool is stashed for the tool-call hook to execute.
        Returns the tool or ``None`` when A2UI is not applicable.
        """
        if get_a2ui_tools is None:
            return None
        state = request.state or {}

        # (1) Opt-in: only inject when the host turned the A2UI tool on.
        if not self._a2ui_inject_decision(state):
            return None

        # Bind to the frontend's catalog when one was registered (optional).
        resolved = self._resolve_a2ui_catalog(state)
        component_schema, catalog_id = resolved if resolved else (None, None)

        # Shared A2UIToolParams: a single params object owned by the toolkit.
        # Start from the host overrides (guidelines / catalog id / tool name /
        # recovery) so a host can steer the subagent, then layer in only what
        # the host cannot know — the bound model, and the registered catalog id
        # + component schema — without clobbering any host-set value.
        params: "A2UIToolParams" = dict(self._a2ui_params)
        params["model"] = request.model
        if catalog_id and "default_catalog_id" not in params:
            params["default_catalog_id"] = catalog_id
        # Feed the registered component schema to the subagent so it composes
        # only catalog components (the toolkit appends this to its prompt).
        # Merge into any host ``guidelines`` bag; a host-set composition_guide
        # wins, and host generation/design overrides are preserved.
        if component_schema:
            guidelines = dict(params.get("guidelines") or {})
            guidelines.setdefault("composition_guide", component_schema)
            params["guidelines"] = guidelines

        tool = get_a2ui_tools(params)

        # (2) Don't double-inject if the agent already defines this tool.
        existing_names = {getattr(t, "name", None) for t in (request.tools or [])}
        if tool.name in existing_names:
            return None

        _a2ui_tools_by_thread[_current_thread_id() or _DEFAULT_THREAD_KEY] = tool
        return tool

    # Inject frontend + A2UI tools and surface user state before model call
    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelResponse:
        _extract_forwarded_headers_from_config()
        _ensure_httpx_hook(request.model)
        request = self._apply_state_note(request)
        request = self._apply_app_context_note(request)

        a2ui_tool = self._maybe_build_a2ui_tool(request)
        frontend_tools = request.state.get("copilotkit", {}).get("actions", [])
        if a2ui_tool is not None:
            # Our generate_a2ui replaces the runtime's render tool — don't
            # advertise both. Drop the render tool the A2UI middleware injected.
            decision = self._a2ui_inject_decision(request.state or {})
            drop = decision if isinstance(decision, str) else "render_a2ui"
            frontend_tools = [
                t
                for t in frontend_tools
                if ((t.get("function") or {}).get("name") or t.get("name")) != drop
            ]

        if not frontend_tools and a2ui_tool is None:
            return handler(request)

        extra_tools = [a2ui_tool] if a2ui_tool is not None else []
        merged_tools = [*request.tools, *extra_tools, *frontend_tools]

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
        _extract_forwarded_headers_from_config()
        _ensure_httpx_hook(request.model)
        self._fix_messages_for_bedrock(request.messages)
        request = self._apply_state_note(request)
        request = self._apply_app_context_note(request)

        a2ui_tool = self._maybe_build_a2ui_tool(request)
        frontend_tools = request.state.get("copilotkit", {}).get("actions", [])
        if a2ui_tool is not None:
            # Our generate_a2ui replaces the runtime's render tool — don't
            # advertise both. Drop the render tool the A2UI middleware injected.
            decision = self._a2ui_inject_decision(request.state or {})
            drop = decision if isinstance(decision, str) else "render_a2ui"
            frontend_tools = [
                t
                for t in frontend_tools
                if ((t.get("function") or {}).get("name") or t.get("name")) != drop
            ]

        if not frontend_tools and a2ui_tool is None:
            return await handler(request)

        extra_tools = [a2ui_tool] if a2ui_tool is not None else []
        merged_tools = [*request.tools, *extra_tools, *frontend_tools]

        return await handler(request.override(tools=merged_tools))

    # ------------------------------------------------------------------
    # Auto-A2UI tool execution
    # ------------------------------------------------------------------
    # The generate_a2ui tool is advertised dynamically in wrap_model_call and is
    # NOT in create_agent's static tool registry, so the tool node cannot
    # execute it on its own. These hooks supply the implementation (built with
    # the inferred model) for that one tool; their presence also disables
    # create_agent's "unknown tool" guard for dynamically-advertised tools.

    def _resolve_a2ui_request(self, request: Any) -> Any:
        """Return a request overridden with the stashed A2UI tool when this
        tool call targets it, else the original request unchanged."""
        tool = _a2ui_tools_by_thread.get(_current_thread_id() or _DEFAULT_THREAD_KEY)
        if (
            tool is not None
            and getattr(request, "tool", None) is None
            and request.tool_call.get("name") == tool.name
        ):
            return request.override(tool=tool)
        return request

    def wrap_tool_call(
        self,
        request: Any,
        handler: Callable[[Any], Any],
    ) -> Any:
        return handler(self._resolve_a2ui_request(request))

    async def awrap_tool_call(
        self,
        request: Any,
        handler: Callable[[Any], Awaitable[Any]],
    ) -> Any:
        return await handler(self._resolve_a2ui_request(request))

    # Inject app context before agent runs
    def before_agent(
        self,
        state: StateSchema,
        runtime: Runtime[Any],
    ) -> dict[str, Any] | None:
        return None

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
        # Drop the bridged A2UI tool for this run — all tool calls for the turn
        # have executed by now; the next model call re-stashes if needed.
        _a2ui_tools_by_thread.pop(_current_thread_id() or _DEFAULT_THREAD_KEY, None)

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
