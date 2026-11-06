"""Builds the Antigravity agent and its approval policy.

Two adapter features carry the human-in-the-loop design:

* `tool_approval=True` parks every tool call on an AG-UI interrupt
  (`reason="tool_approval"`, metadata `{tool_name, args}`) until the browser
  answers through `RunAgentInput.resume`.
* `auto_approve_tools` lets the read-only and test tools run without asking,
  so only installs, file edits, shell commands and pushes prompt.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import uuid
from collections.abc import AsyncIterator
from typing import Any

from ag_ui.core import (
    BaseEvent,
    EventType,
    RunAgentInput,
    RunErrorEvent,
    RunFinishedEvent,
    StateSnapshotEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
)
from ag_ui_antigravity import AntigravityAgent
from google.antigravity import CapabilitiesConfig
from google.antigravity.hooks import policy
from google.antigravity.models import GeminiModelOptions, ThinkingLevel
from google.antigravity.types import BuiltinTools, GeminiAPIEndpoint, Step, StepStatus

from .approvals import ApprovalLog
from .config import Settings
from .guards import cpu_only_installs, guard_hook
from .harness_steps import DENIED_BY_HOOK, HarnessCalls, StepShaper, recoverable_error
from .prompts import SYSTEM_INSTRUCTIONS
from .snapshot import Snapshots, Snapshotter, backup_sqlite, open_store
from .tools import AUTO_APPROVED_TOOLS, build_tools
from .uvcache import CacheGuard, prune
from .venvs import VenvCleanupSessionManager, clear_venv_root
from .workspace import Workspace, workspace_key

logger = logging.getLogger(__name__)

# google-antigravity 0.1.22 raises AntigravityExecutionError when a pre-tool
# decide hook denies a call, although the harness itself carries on and lets the
# model answer. The adapter turns that exception into RUN_ERROR. This marker
# identifies it so the run can end cleanly instead (see `_deny_as_finish`).
_DENIED_BY_HOOK = DENIED_BY_HOOK


def _deny_as_finish(thread_id: str, run_id: str) -> list[BaseEvent]:
    """Ends a run the user stopped with a short note instead of an error."""
    message_id = str(uuid.uuid4())
    note = "Stopped here because you denied that action. Tell me how you want to continue."
    return [
        TextMessageStartEvent(
            type=EventType.TEXT_MESSAGE_START, message_id=message_id, role="assistant"
        ),
        TextMessageContentEvent(
            type=EventType.TEXT_MESSAGE_CONTENT, message_id=message_id, delta=note
        ),
        TextMessageEndEvent(type=EventType.TEXT_MESSAGE_END, message_id=message_id),
        RunFinishedEvent(type=EventType.RUN_FINISHED, thread_id=thread_id, run_id=run_id),
    ]


def recover_tool_error(step: Step) -> Step:
    """Turns a recoverable failed step into a completed tool call that carries the error.

    The harness reports a tool that fails on bad input (view_file on a missing
    path, manage_task killing a task that already finished) as an ERROR step,
    then hands the error to the model and carries on. ag-ui-antigravity 0.2.1
    treats every ERROR step as fatal (`step_failure`) and ends the run as
    RUN_ERROR. A completed call with an `error` key makes the adapter close it
    with a "There was an error executing ..." result, and the run keeps
    streaming. Denials and model, quota or auth failures are returned as they
    are (see `harness_steps.recoverable_error`).
    """
    tool = recoverable_error(step)
    if tool is None:
        return step
    return StepShaper(HarnessCalls())._recover(step, tool)


# The harness built-ins this agent may use. `finish` must stay: the harness
# ends a turn with it. Web search, image generation, sub-agents and
# `ask_question` stay off.
ENABLED_BUILTINS = [
    BuiltinTools.LIST_DIR,
    BuiltinTools.SEARCH_DIR,
    BuiltinTools.FIND_FILE,
    BuiltinTools.VIEW_FILE,
    BuiltinTools.EDIT_FILE,
    BuiltinTools.RUN_COMMAND,
    BuiltinTools.FINISH,
]

# Read-only built-ins. The approval hook sees built-ins under their SDK enum
# values (`view_file`, `search_directory`, ...), not the names the model sees
# (`grep_search`, `find_by_name`, ...). `finish` ends every turn.
READ_ONLY_BUILTINS = tuple(
    tool.value
    for tool in (
        BuiltinTools.LIST_DIR,
        BuiltinTools.SEARCH_DIR,
        BuiltinTools.FIND_FILE,
        BuiltinTools.VIEW_FILE,
        BuiltinTools.FINISH,
    )
)
AUTO_APPROVED = (*AUTO_APPROVED_TOOLS, *READ_ONLY_BUILTINS)


class ThreadScopedAntigravityAgent(AntigravityAgent):  # type: ignore[misc]
    """Gives every AG-UI thread its own workspace and its own bound tools.

    The adapter takes one fixed `workspaces` list per agent. Antigravity itself
    configures workspaces per conversation, so this override swaps in the
    thread's folder (and tools bound to it) while the adapter builds that
    thread's session.

    It relies on the adapter's private `_build_agent`, `_workspaces` and
    `_static_tools`, and the SDK agent's `_config` (ag-ui-antigravity 0.2.1,
    google-antigravity 0.1.22, both pinned). `_build_agent` is
    synchronous, so the swap cannot interleave with another thread's build.
    """

    # Set by the adapter's __init__; declared here for the type checker.
    _workspaces: list[str]
    _static_tools: list[Any]

    def __init__(
        self,
        *,
        settings: Settings,
        cache: CacheGuard | None = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self._settings = settings
        self._cache = cache
        store = open_store(settings.workspace_bucket)
        # Saves each thread's workspace and harness session to the bucket, and
        # restores them after a restart (snapshot.py). None without a bucket.
        self.snapshots: Snapshotter | None = (
            Snapshotter(Snapshots(store, settings), self._sessions) if store else None
        )
        self._approvals = ApprovalLog()
        # Per thread: what the SDK hooks saw of each harness tool call (see
        # harness_steps). Replaced whenever the thread's agent is rebuilt.
        self._harness_calls: dict[str, HarnessCalls] = {}

    async def run(self, input_data: RunAgentInput) -> AsyncIterator[BaseEvent]:
        """Runs the adapter, logging approval decisions into shared state.

        Two additions around the adapter's own run:
        * every answered approval interrupt is appended to `state.approvals`;
        * a run that ends because the user denied a call finishes cleanly.
        """
        thread_id = input_data.thread_id
        if self.snapshots is not None:
            # A thread whose folder is gone (a restart) comes back from the
            # bucket before its session is built, so the session resumes it.
            await self.snapshots.restore(thread_id)
        try:
            async for event in self._run_rebuilding(input_data):
                yield event
        finally:
            if self.snapshots is not None:
                # After every run: covers edits, approved commands and pushes.
                self.snapshots.schedule(thread_id)

    async def _run_rebuilding(self, input_data: RunAgentInput) -> AsyncIterator[BaseEvent]:
        """Runs once more on a rebuilt session when the harness connection was closed.

        The Antigravity harness can close a conversation's WebSocket while the
        adapter still holds the session (seen on Cloud Run: "ConnectionClosedOK:
        received 1000 (OK)"). The adapter then fails the next message and only
        rebuilds on the one after. When a new message fails that way before
        anything streamed, the session database is compacted (so history still
        in its WAL is kept), the adapter rebuilds the session from it on the
        retry, and the same message is sent again in this run.
        """
        thread_id = input_data.thread_id
        retried = False
        started = False
        streamed = False
        async for event in self._run(input_data):
            if (
                isinstance(event, RunErrorEvent)
                and not streamed
                and not input_data.resume
                and self._harness_lost(thread_id)
            ):
                retried = True
                break
            if event.type == EventType.RUN_STARTED:
                started = True
            elif event.type != EventType.STATE_SNAPSHOT:
                streamed = True
            yield event
        if not retried:
            return
        logger.warning(
            "Harness connection for thread %s was closed; rebuilding the session from its "
            "saved conversation and sending the message again",
            thread_id,
        )
        await asyncio.to_thread(self._compact_session_db, thread_id)
        async for event in self._run(input_data):
            if event.type == EventType.RUN_STARTED and started:
                continue  # the client already has this run's start
            yield event

    def _harness_lost(self, thread_id: str) -> bool:
        session = self._sessions._sessions.get(thread_id)
        return bool(session is not None and getattr(session, "harness_lost", False))

    def _compact_session_db(self, thread_id: str) -> None:
        """Folds the session database's WAL into the main file.

        The harness reopens a conversation's database with `immutable=1`, which
        ignores the WAL, so anything not yet checkpointed would be missing from
        the rebuilt session. A missing file is left alone: the snapshot restore
        (or a fresh conversation) covers that case.
        """
        session = self._sessions._sessions.get(thread_id)
        conv = getattr(getattr(session, "agent", None), "conversation_id", None) or getattr(
            session, "conversation_id", None
        )
        if not conv:
            return
        db = self._settings.save_dir / f"{conv}.db"
        wal = db.with_name(f"{db.name}-wal")
        if not db.is_file() or not wal.exists():
            return
        compacted = db.with_name(f"{db.name}.compact")
        try:
            backup_sqlite(db, compacted)
            os.replace(compacted, db)
            wal.unlink(missing_ok=True)
            db.with_name(f"{db.name}-shm").unlink(missing_ok=True)
        except Exception:
            compacted.unlink(missing_ok=True)
            logger.exception("Could not compact the session database of thread %s", thread_id)

    async def _run(self, input_data: RunAgentInput) -> AsyncIterator[BaseEvent]:
        thread_id = input_data.thread_id
        answers = list(input_data.resume or [])
        forwarded = input_data.forwarded_props
        answered = isinstance(forwarded, dict) and "command" in forwarded
        if answered and isinstance(forwarded, dict):
            # An answer sent as forwardedProps.command (CopilotKit Channels)
            # moves into `resume`, so it is checked and logged like any other
            # and the adapter reads that one value.
            entry = self._approvals.command_as_answer(thread_id, forwarded["command"])
            rest = {key: value for key, value in forwarded.items() if key != "command"}
            input_data = input_data.model_copy(update={"forwarded_props": rest})
            if entry is not None and not answers:
                answers = [entry]
        if not answers and not answered:
            # A new turn: anything still pending was abandoned by the user.
            self._approvals.forget(thread_id)
        else:
            # Before both the log and the adapter read them, so they agree.
            answers = self._approvals.sanitize(thread_id, answers)
            input_data = input_data.model_copy(update={"resume": answers})
        decisions = self._approvals.decide(thread_id, answers)
        denied = any(d["decision"] == "denied" for d in decisions)
        snapshot: dict[str, Any] | None = None
        if decisions:
            state = dict(input_data.state) if isinstance(input_data.state, dict) else {}
            snapshot = {**state, "approvals": [*state.get("approvals", []), *decisions]}
            # The adapter adopts the client's state at run start, so tools that
            # update state later in this run build on the logged decisions.
            input_data = input_data.model_copy(update={"state": snapshot})

        async for event in super().run(input_data):
            if (
                isinstance(event, RunErrorEvent)
                and denied
                and _DENIED_BY_HOOK in (event.message or "")
            ):
                for replacement in _deny_as_finish(thread_id, input_data.run_id):
                    yield replacement
                continue
            yield event
            if snapshot is not None and event.type == EventType.RUN_STARTED:
                yield StateSnapshotEvent(type=EventType.STATE_SNAPSHOT, snapshot=snapshot)
            elif event.type == EventType.RUN_FINISHED:
                outcome = getattr(event, "outcome", None)
                if outcome is not None and getattr(outcome, "type", None) == "interrupt":
                    self._approvals.remember(
                        thread_id, list(outcome.interrupts), workspace_key(thread_id)
                    )

    async def delete_thread(self, thread_id: str) -> None:
        """Removes everything a deleted conversation left: its session, local
        folders, harness history and its folder in the bucket."""
        conversations: set[str] = set()
        if self.snapshots is not None:
            current = self.snapshots.conversation(thread_id).conversation_id
            saved = await self.snapshots.stop(thread_id)
            conversations |= {c for c in (current, saved) if c}
        session = self._sessions._sessions.get(thread_id)
        if session is not None:
            live = session.conversation_id or getattr(session.agent, "conversation_id", None)
            if live:
                conversations.add(live)
        remembered = self._sessions._remembered.get(thread_id)
        if remembered is not None and remembered[0]:
            conversations.add(remembered[0])
        await self._sessions.close(thread_id)
        self._sessions._remembered.pop(thread_id, None)
        self._harness_calls.pop(thread_id, None)
        ws = Workspace.for_thread(
            thread_id,
            root=self._settings.workspace_root,
            push_root=self._settings.push_root,
            venv_root=self._settings.venv_root,
        )
        for path in (ws.path, ws.push_remote, ws.venv):
            await asyncio.to_thread(shutil.rmtree, path, True)
        for conv in conversations:
            for suffix in (".db", ".db-wal", ".db-shm"):
                (self._settings.save_dir / f"{conv}{suffix}").unlink(missing_ok=True)
        if self.snapshots is not None:
            await self.snapshots.delete(thread_id)
        logger.info(
            "Deleted thread %s: workspace %s, conversations %s",
            thread_id,
            ws.key,
            sorted(conversations) or "none",
        )

    async def _steps_with_bridge(self, session: Any, bridge: Any) -> AsyncIterator[Step]:
        shaper = getattr(session, "_rd_shaper", None)
        if shaper is None:
            calls = self._harness_calls.get(session.thread_id) or HarnessCalls()
            shaper = StepShaper(calls)
            session._rd_shaper = shaper
        async for step in super()._steps_with_bridge(session, bridge):
            if step.status == StepStatus.ERROR:
                logger.info(
                    "Step error: type=%s source=%s calls=%s error=%s",
                    step.type,
                    step.source,
                    [str(c.name) for c in step.tool_calls],
                    step.error[:200],
                )
            for shaped in shaper.shape(step):
                yield shaped

    def _build_agent(self, bridge: Any, input_data: Any, previous_conversation_id: Any) -> Any:
        workspace = Workspace.for_thread(
            input_data.thread_id,
            root=self._settings.workspace_root,
            push_root=self._settings.push_root,
            venv_root=self._settings.venv_root,
        )
        workspace.ensure()
        saved: tuple[list[str], list[Any]] = (self._workspaces, self._static_tools)
        self._workspaces = [str(workspace.path)]
        snapshots = self.snapshots
        thread_id = input_data.thread_id
        self._static_tools = build_tools(
            workspace,
            self._settings,
            on_change=(lambda: snapshots.schedule(thread_id)) if snapshots else None,
            cache=self._cache,
        )
        try:
            built = super()._build_agent(bridge, input_data, previous_conversation_id)
        finally:
            self._workspaces, self._static_tools = saved
        # With tool_approval on, the adapter passes no policies, so the SDK
        # falls back to policy.confirm_run_command(), which denies run_command
        # outright: a shell command the user just approved would still fail.
        # The approval hook already gates every call, so the policy layer can
        # allow everything. The agent is not started yet, so this takes effect.
        built._config.policies = [policy.allow_all()]
        # Record every harness tool call (first, so it sees calls the approval
        # hook parks) and every result, for the task rows in the chat. The SDK
        # agent copies its hooks at construction, so they go on its pending
        # list (google-antigravity 0.1.22 `Agent._pending_hooks`).
        calls = HarnessCalls()
        self._harness_calls[input_data.thread_id] = calls
        record_call, record_result = calls.hooks()
        built._pending_hooks.insert(0, record_call)
        # Hard limits first of all: no installs through run_command, no killing
        # background tasks (guards.py). Rejected calls never reach the
        # approval card.
        built._pending_hooks.insert(0, guard_hook())
        built._pending_hooks.append(record_result)
        return built


def _endpoint(settings: Settings) -> GeminiAPIEndpoint | None:
    """The Gemini endpoint, when it differs from the adapter's default.

    Set for a Gemini-compatible server (`GOOGLE_GEMINI_BASE_URL`) and for a
    thinking level (`GEMINI_THINKING_LEVEL`, passed as the SDK's
    `GeminiModelOptions(thinking_level=...)`). The adapter adds the API key.
    """
    raw_url = settings.google_gemini_base_url
    base_url = raw_url.rstrip("/") if raw_url else None
    level = settings.gemini_thinking_level
    if base_url is None and level is None:
        return None
    options = GeminiModelOptions(thinking_level=ThinkingLevel(level)) if level else None
    return GeminiAPIEndpoint(base_url=base_url, options=options)


def create_agent(settings: Settings) -> ThreadScopedAntigravityAgent:
    settings.workspace_root.mkdir(parents=True, exist_ok=True)
    settings.save_dir.mkdir(parents=True, exist_ok=True)
    settings.push_root.mkdir(parents=True, exist_ok=True)
    # No session survives a restart, so no venv is in use yet.
    clear_venv_root(settings.venv_root)
    # The agent's own uv cache: every install (and approved shell command)
    # inherits it, and only it is ever pruned or cleared.
    settings.uv_cache_dir.mkdir(parents=True, exist_ok=True)
    os.environ["UV_CACHE_DIR"] = str(settings.uv_cache_dir)
    # PyTorch as CPU wheels for every install: no CUDA downloads, no GPU here.
    cpu_only_installs()
    prune()
    return ThreadScopedAntigravityAgent(
        settings=settings,
        cache=CacheGuard(settings.uv_cache_max_bytes),
        model=settings.gemini_model,
        api_key=settings.gemini_api_key.get_secret_value(),
        endpoint=_endpoint(settings),
        system_instructions=SYSTEM_INSTRUCTIONS,
        capabilities=CapabilitiesConfig(enabled_tools=ENABLED_BUILTINS, enable_subagents=False),
        # Replaced per thread by ThreadScopedAntigravityAgent._build_agent.
        workspaces=[str(settings.workspace_root)],
        save_dir=str(settings.save_dir),
        enable_ask_question=False,
        tool_approval=True,
        auto_approve_tools=list(AUTO_APPROVED),
        max_tool_calls_per_turn=settings.max_tool_calls_per_turn,
        # The adapter's defaults (30 min idle, 2 h parked on an approval).
        session_manager=VenvCleanupSessionManager(venv_root=settings.venv_root),
    )
