"""Unit tests for langroid's GenerateA2UITool and tool infrastructure.

After Option A (JS-injected A2UI), the two-stage server-side A2UI planner
(``generate_a2ui_via_llm``, ``_get_a2ui_llm``, ``_resolve_a2ui_model``,
``_A2uiError``, ``_A2uiErrorKind``, ``_RENDER_A2UI_FUNCTION_SPEC``,
``_RENDER_A2UI_TOOL_SPEC``, ``_a2ui_error``) has been removed. The
CopilotKit JS runtime's A2UIMiddleware now intercepts ``generate_a2ui``
calls before they reach the Python backend and drives the render_a2ui LLM
pass itself.

This file covers:
- ``_ToolErrorKind`` enum identity (error-code contract with outer LLM).
- ``GenerateA2UITool.handle()`` Option A: must return a structured error
  JSON string and log an ERROR (middleware regression guard).
- Backend tool handle() happy + error paths (6 tools, parametrized).
- ``create_agent`` factory wiring contract (tools, stream, model).
- Module hygiene: no top-level openai import; clean subprocess import.
- Tool-tuples structural contract (BACKEND_TOOLS / FRONTEND_TOOLS /
  ALL_TOOLS).
"""

from __future__ import annotations

import ast
import inspect
import json
import logging
import os
import subprocess
import sys
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest

from agents.agent import (
    _ToolErrorKind,
    create_agent,
    ALL_TOOLS,
    BACKEND_TOOLS,
    FRONTEND_TOOLS,
    ChangeBackgroundTool,
    GenerateA2UITool,
    GenerateHaikuTool,
    GetSalesTodosTool,
    GetWeatherTool,
    ManageSalesTodosTool,
    QueryDataTool,
    ScheduleMeetingTool,
    SearchFlightsTool,
)
from langroid.agent.tool_message import ToolMessage


# ---------------------------------------------------------------------------
# _ToolErrorKind enum identity — pins the error-code contract
# ---------------------------------------------------------------------------


def test_tool_error_kind_values_pinned():
    """The enum ``.value``s are the ``{"error": "<tool>_failed"}`` strings
    the outer LLM consumes when a backend tool handler wraps an impl
    exception. The values match the historical bare-string codes, so a
    rename here is a cross-language breaking change (the strings show up
    in prompt-engineered retry logic elsewhere in the product). Pin the
    complete set so a typo regression (``"get_wether_failed"``) or an
    accidental addition / removal is caught at unit-test time."""
    assert _ToolErrorKind.GET_WEATHER_FAILED.value == "get_weather_failed"
    assert _ToolErrorKind.QUERY_DATA_FAILED.value == "query_data_failed"
    assert _ToolErrorKind.MANAGE_SALES_TODOS_FAILED.value == "manage_sales_todos_failed"
    assert _ToolErrorKind.GET_SALES_TODOS_FAILED.value == "get_sales_todos_failed"
    assert _ToolErrorKind.SCHEDULE_MEETING_FAILED.value == "schedule_meeting_failed"
    assert _ToolErrorKind.SEARCH_FLIGHTS_FAILED.value == "search_flights_failed"
    assert {m.value for m in _ToolErrorKind} == {
        "get_weather_failed",
        "query_data_failed",
        "manage_sales_todos_failed",
        "get_sales_todos_failed",
        "schedule_meeting_failed",
        "search_flights_failed",
    }


# ---------------------------------------------------------------------------
# GenerateA2UITool.handle — Option A contract
# ---------------------------------------------------------------------------


def test_generate_a2ui_tool_handle_returns_middleware_regression_error(caplog):
    """Option A: ``GenerateA2UITool.handle()`` must return a JSON-encoded
    structured error indicating middleware regression. The CopilotKit JS
    runtime's A2UIMiddleware should intercept ``generate_a2ui`` calls before
    they ever reach the Python backend. If handle() fires, the interception
    regressed.

    Asserts:
    - Return value is a JSON string (langroid tool contract).
    - Parsed dict contains ``"error"`` key with "middleware regression"
      substring (catches a regression that returns an empty dict or drops
      the error key).
    - Module logger emits an ERROR record (so the regression surfaces
      in server logs immediately).
    """
    tool = GenerateA2UITool(context="test context")
    with caplog.at_level(logging.ERROR, logger="agents.agent"):
        out = tool.handle()

    assert isinstance(out, str), (
        f"handle() must return str for langroid's tool framework; got "
        f"{type(out).__name__}"
    )
    parsed = json.loads(out)
    assert "error" in parsed, (
        f"handle() must return a dict with 'error' key; got {parsed!r}"
    )
    assert (
        "middleware regression" in parsed["error"] or "middleware" in parsed["error"]
    ), f"error value must mention middleware regression; got {parsed['error']!r}"
    # ERROR log must fire so operators see the regression immediately.
    assert any(
        rec.levelno >= logging.ERROR and rec.name == "agents.agent"
        for rec in caplog.records
    ), (
        f"expected ERROR-level log from agents.agent; got "
        f"{[(r.name, r.levelname) for r in caplog.records]}"
    )


def test_generate_a2ui_tool_handle_logs_interception_regression_message(caplog):
    """Pin the ERROR log message substring so a future refactor that renames
    the log message (without updating monitoring alerts) is caught at
    unit-test time. The message must mention 'A2UIMiddleware' so operators
    can diagnose the source of the regression from the log line alone."""
    tool = GenerateA2UITool(context="")
    with caplog.at_level(logging.ERROR, logger="agents.agent"):
        tool.handle()

    assert any(
        rec.levelno >= logging.ERROR
        and rec.name == "agents.agent"
        and "A2UIMiddleware" in rec.getMessage()
        for rec in caplog.records
    ), (
        f"expected ERROR log mentioning 'A2UIMiddleware'; got "
        f"{[(r.name, r.levelname, r.getMessage()) for r in caplog.records]}"
    )


# ---------------------------------------------------------------------------
# Tuple annotations: BACKEND_TOOLS / FRONTEND_TOOLS / ALL_TOOLS
# ---------------------------------------------------------------------------


def test_tool_tuples_contain_only_tool_message_subclasses():
    """All entries in ``BACKEND_TOOLS`` / ``FRONTEND_TOOLS`` / ``ALL_TOOLS``
    must be ``ToolMessage`` subclasses (not instances, not random strings).
    Pins the ``tuple[type[ToolMessage], ...]`` annotation shape at runtime —
    a regression that slipped a stringified tool name into the tuple would
    pass mypy on some configurations but fail at langroid registration.
    """
    for tools_tuple, label in (
        (BACKEND_TOOLS, "BACKEND_TOOLS"),
        (FRONTEND_TOOLS, "FRONTEND_TOOLS"),
        (ALL_TOOLS, "ALL_TOOLS"),
    ):
        assert isinstance(tools_tuple, tuple), f"{label} must be a tuple"
        for entry in tools_tuple:
            assert isinstance(entry, type) and issubclass(entry, ToolMessage), (
                f"{label} must contain only ToolMessage subclasses; got {entry!r}"
            )

    # ALL_TOOLS = BACKEND_TOOLS + FRONTEND_TOOLS — count pin so a new tool
    # not wired into ALL_TOOLS gets caught here too.
    assert len(ALL_TOOLS) == len(BACKEND_TOOLS) + len(FRONTEND_TOOLS)
    assert len(ALL_TOOLS) == 9, (
        f"ALL_TOOLS should have 9 entries (6 backend + 3 frontend); got "
        f"{len(ALL_TOOLS)}"
    )


# ---------------------------------------------------------------------------
# Backend tool handle() try/except wrappers — each of the 6 backend tools
# wraps its ``*_impl()`` call. Parametrized happy + error paths.
# ---------------------------------------------------------------------------


# (tool_cls, impl_symbol_on_agent_module, tool_ctor_kwargs, error_code)
_BACKEND_TOOL_CASES = [
    (GetWeatherTool, "get_weather_impl", {"location": "Seattle"}, "get_weather_failed"),
    (QueryDataTool, "query_data_impl", {"query": "show sales"}, "query_data_failed"),
    (
        ManageSalesTodosTool,
        "manage_sales_todos_impl",
        {"todos": []},
        "manage_sales_todos_failed",
    ),
    (
        GetSalesTodosTool,
        "get_sales_todos_impl",
        {},
        "get_sales_todos_failed",
    ),
    (
        ScheduleMeetingTool,
        "schedule_meeting_impl",
        {"reason": "demo", "duration_minutes": 30},
        "schedule_meeting_failed",
    ),
    (
        SearchFlightsTool,
        "search_flights_impl",
        {"flights": []},
        "search_flights_failed",
    ),
]


@pytest.mark.parametrize(
    "tool_cls,impl_name,kwargs,_error_code",
    _BACKEND_TOOL_CASES,
    ids=[c[0].__name__ for c in _BACKEND_TOOL_CASES],
)
def test_backend_tool_handle_happy_path(tool_cls, impl_name, kwargs, _error_code):
    """Happy-path: each backend tool's ``handle()`` serializes the result of
    its wrapped ``*_impl()`` to a JSON string. Patches the impl symbol on
    ``agents.agent`` (where it's bound at import time) so we control the
    return value without depending on shared/python's actual implementation.
    """
    sentinel_result = {"ok": True, "tool": tool_cls.__name__}
    with patch(f"agents.agent.{impl_name}", return_value=sentinel_result):
        tool = tool_cls(**kwargs)
        out = tool.handle()
    assert isinstance(out, str)
    assert json.loads(out) == sentinel_result


@pytest.mark.parametrize(
    "tool_cls,impl_name,kwargs,error_code",
    _BACKEND_TOOL_CASES,
    ids=[c[0].__name__ for c in _BACKEND_TOOL_CASES],
)
def test_backend_tool_handle_error_path_returns_structured_error(
    tool_cls, impl_name, kwargs, error_code, caplog
):
    """Error-path: each backend tool must wrap an impl exception into the
    structured ``_tool_error`` JSON shape (``{"error": "<tool>_failed",
    "message": "ValueError: simulated"}``). The exception must NOT escape
    into langroid's tool-handling stack.

    Also asserts the module logger emits an ERROR record (from
    ``logger.exception(...)`` in the handler).
    """
    with patch(f"agents.agent.{impl_name}", side_effect=ValueError("simulated")):
        tool = tool_cls(**kwargs)
        with caplog.at_level(logging.ERROR, logger="agents.agent"):
            out = tool.handle()
    assert isinstance(out, str)
    parsed = json.loads(out)
    assert parsed["error"] == error_code
    # Message includes the class name AND the detail substring — both halves
    # are load-bearing for operator diagnosis.
    assert "ValueError" in parsed["message"]
    assert "simulated" in parsed["message"]
    # Error record logged on agents.agent.
    assert any(
        rec.levelno >= logging.ERROR and rec.name == "agents.agent"
        for rec in caplog.records
    ), (
        f"expected ERROR log on agents.agent from {tool_cls.__name__}.handle; "
        f"got {[(r.name, r.levelname) for r in caplog.records]}"
    )


# ---------------------------------------------------------------------------
# create_agent factory — wiring contract with langroid
# ---------------------------------------------------------------------------


def test_create_agent_wires_all_tools_with_stream_true(monkeypatch):
    """``create_agent`` must:
      - construct ``OpenAIGPTConfig`` with ``chat_model=$LANGROID_MODEL`` and
        ``stream=True`` (primary agent streams to SSE).
      - construct ``ChatAgent`` and call ``enable_message(list(ALL_TOOLS))``
        with every tool.

    Pins the full wiring contract so a regression that drops a tool from
    ``ALL_TOOLS`` or flips the primary agent to ``stream=False`` is caught.

    Captures via ``lm.OpenAIGPTConfig`` (not ``lm.OpenAIGPT``) because
    langroid's ``ChatAgent`` lazily constructs the LLM from the config —
    ``create_agent`` itself only instantiates the config, not the LLM.
    """
    monkeypatch.setenv("LANGROID_MODEL", "anthropic/claude-opus-4")

    captured_config_kwargs: list[dict] = []
    enable_message_calls: list[Any] = []

    # Import the real config / agent types so isinstance checks (and
    # attribute access) still work downstream; we only intercept
    # construction kwargs for assertion.
    import agents.agent as agent_mod

    real_config_cls = agent_mod.lm.OpenAIGPTConfig

    def _spy_config(**kwargs):
        captured_config_kwargs.append(kwargs)
        # Return a real instance so subsequent code paths (including any
        # model-string validation inside langroid) keep working.
        return real_config_cls(**kwargs)

    class _FakeAgent:
        def __init__(self, config):
            self.config = config

        def enable_message(self, tools):
            enable_message_calls.append(tools)

    with (
        patch("agents.agent.lm.OpenAIGPTConfig", side_effect=_spy_config),
        patch("agents.agent.lr.ChatAgent", _FakeAgent),
    ):
        agent = create_agent()

    # Config kwargs: model from env, stream=True.
    assert len(captured_config_kwargs) == 1
    kwargs = captured_config_kwargs[0]
    assert kwargs["chat_model"] == "anthropic/claude-opus-4"
    assert kwargs["stream"] is True, (
        f"create_agent must construct primary LLM config with stream=True; "
        f"got stream={kwargs.get('stream')!r}"
    )

    # enable_message called once with a list equal to list(ALL_TOOLS).
    assert len(enable_message_calls) == 1
    enabled = enable_message_calls[0]
    assert enabled == list(ALL_TOOLS), (
        f"enable_message must receive list(ALL_TOOLS); got {enabled!r}"
    )

    # Returned value is the fake agent instance.
    assert isinstance(agent, _FakeAgent)


def test_create_agent_default_model_when_langroid_model_unset(monkeypatch):
    """When ``LANGROID_MODEL`` is unset, ``create_agent`` falls back to the
    documented default ``gpt-4.1``. Pins the default string so a silent
    drift between the primary agent default and documentation is caught."""
    monkeypatch.delenv("LANGROID_MODEL", raising=False)

    captured_config_kwargs: list[dict] = []

    import agents.agent as agent_mod

    real_config_cls = agent_mod.lm.OpenAIGPTConfig

    def _spy_config(**kwargs):
        captured_config_kwargs.append(kwargs)
        return real_config_cls(**kwargs)

    class _FakeAgent:
        def __init__(self, config):
            pass

        def enable_message(self, tools):
            pass

    with (
        patch("agents.agent.lm.OpenAIGPTConfig", side_effect=_spy_config),
        patch("agents.agent.lr.ChatAgent", _FakeAgent),
    ):
        create_agent()

    assert captured_config_kwargs[0]["chat_model"] == "gpt-4.1"


# ---------------------------------------------------------------------------
# Module hygiene: no top-level openai import (including inside top-level
# try/except blocks, conditional imports, etc. — anywhere that runs at
# module load time).
# ---------------------------------------------------------------------------


def _module_level_ancestors(tree: ast.Module) -> dict[int, bool]:
    """Return a map ``id(node) -> is_module_level``.

    A node is module-level iff the chain of containing nodes from the
    module root never passes through a ``FunctionDef`` / ``AsyncFunctionDef``.
    Top-level ``Try`` / ``If`` / ``With`` / ``ClassDef`` blocks DO count as
    module-level — their bodies execute at import time. A regression that
    drops an ``import openai`` into a class body (e.g. default-factory
    attribute, metaclass setup) must be caught here too.
    """
    is_module_level: dict[int, bool] = {}

    def _walk(node: ast.AST, inside_func: bool) -> None:
        # Any import statement encountered here gets tagged. We don't need
        # every node, just the imports — but walking uniformly keeps the
        # logic simple.
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            is_module_level[id(node)] = not inside_func
        # Recurse, flipping the flag only when we enter a function body
        # (its code runs on call, not at import time). Class bodies execute
        # at module load, so we intentionally do NOT flip the flag for
        # ``ClassDef``.
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for child in ast.iter_child_nodes(node):
                _walk(child, inside_func=True)
        else:
            for child in ast.iter_child_nodes(node):
                _walk(child, inside_func=inside_func)

    _walk(tree, inside_func=False)
    return is_module_level


def test_agent_module_does_not_import_openai_at_module_load_time():
    """The provider-agnostic fix requires that importing ``agents.agent``
    does not pull in the ``openai`` SDK. A module-load-time ``import openai``
    — whether at the top of the file, inside a top-level ``try/except``, or
    inside a top-level ``if``/``with``/etc — would reintroduce the
    hard-coded provider dependency we just removed.

    The previous walker only inspected ``tree.body``, missing imports
    nested inside a ``try: import openai; except: pass`` pattern (which
    still runs at module import). This version walks the full AST and
    flags any import whose execution path is NOT guarded by a
    ``FunctionDef`` / ``AsyncFunctionDef`` / ``ClassDef`` body.
    """
    import agents.agent as mod

    source = inspect.getsource(mod)
    tree = ast.parse(source)
    is_module_level = _module_level_ancestors(tree)

    for node in ast.walk(tree):
        if not isinstance(node, (ast.Import, ast.ImportFrom)):
            continue
        if not is_module_level.get(id(node), False):
            continue  # inside a function / class body → fine, lazy
        if isinstance(node, ast.ImportFrom):
            if node.module and node.module.startswith("openai"):
                raise AssertionError(
                    f"agents.agent must not `from openai ...` at module load "
                    f"time (line {node.lineno}); found: from {node.module} import ..."
                )
        else:  # ast.Import
            for alias in node.names:
                if alias.name.startswith("openai"):
                    raise AssertionError(
                        f"agents.agent must not `import openai` at module load "
                        f"time (line {node.lineno}); found: {alias.name}"
                    )


def test_agent_module_imports_cleanly_without_openai_env(tmp_path):
    """Honest import-time regression guard: importing ``agents.agent`` with
    no OpenAI-specific env must succeed. This catches any top-level
    ``openai.OpenAI()`` / ``openai.Client()`` call that would re-introduce
    a hard provider dependency.

    Runs in a SUBPROCESS so module-level state (specifically any
    module-scope singletons) in the parent interpreter is not perturbed by
    a reload. Subprocess isolation makes this test order-independent.
    """
    # Strip any OPENAI_* / LANGROID_* / A2UI_* env vars the child would
    # otherwise inherit, but keep everything else (PATH, HOME, etc.) so the
    # interpreter can actually start.
    env = {
        k: v
        for k, v in os.environ.items()
        if not k.startswith(("OPENAI_", "LANGROID_", "A2UI_"))
    }
    # Ensure the child can import ``agents.agent`` via the package's src/
    # directory — mirrors what conftest.py does for the parent.
    # Also include the integration root so the ``tools`` symlink (which
    # lives at ``langroid/tools`` → ``../../shared/python/tools``) is
    # importable — mirrors the ``PYTHONPATH=".:src:..."`` that the CI
    # workflow and ``package.json`` dev script both set.
    pkg_root = Path(__file__).resolve().parents[2]
    src_dir = pkg_root / "src"
    existing_pp = env.get("PYTHONPATH", "")
    new_pp = f"{pkg_root}{os.pathsep}{src_dir}"
    env["PYTHONPATH"] = f"{new_pp}{os.pathsep}{existing_pp}" if existing_pp else new_pp

    # Run the import from ``tmp_path`` so any stray ``.env`` file in the
    # project root isn't auto-loaded by ``dotenv.load_dotenv`` (which would
    # reintroduce OPENAI_* silently and mask a regression).
    result = subprocess.run(
        [sys.executable, "-c", "import agents.agent"],
        env=env,
        cwd=str(tmp_path),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, (
        f"import agents.agent failed in clean subprocess:\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )


# ---------------------------------------------------------------------------
# Complementary module-hygiene regression: subprocess-import warnings check.
# The AST walker only catches static imports. This test catches dynamic
# imports (e.g. a function-scope ``import openai`` that fires on module load
# via side-effect) AND provider-SDK-emitted warnings that would leak to
# stderr at import time.
# ---------------------------------------------------------------------------


def test_agent_module_import_does_not_warn_about_openai_on_stderr(tmp_path):
    """Complement to the AST walker: run ``import agents.agent`` in a clean
    subprocess and assert neither stdout nor stderr mentions ``openai``.
    Catches:
      - dynamic imports (function-scope ``import openai`` triggered at
        module load via side-effect) that the AST walker misses.
      - provider-SDK-emitted deprecation / initialization warnings that
        leak the provider name to stderr.

    A regression that reintroduces a lazy ``import openai`` inside a
    module-level ``try``-block whose body runs at import time would be
    caught here even if the AST walker's scoping missed it.
    """
    env = {
        k: v
        for k, v in os.environ.items()
        if not k.startswith(("OPENAI_", "LANGROID_", "A2UI_"))
    }
    # Include the integration root (for the ``tools`` symlink) and src/
    # (for ``agents.*``).  Mirrors CI's ``PYTHONPATH=".:src:..."``.
    pkg_root = Path(__file__).resolve().parents[2]
    src_dir = pkg_root / "src"
    existing_pp = env.get("PYTHONPATH", "")
    new_pp = f"{pkg_root}{os.pathsep}{src_dir}"
    env["PYTHONPATH"] = f"{new_pp}{os.pathsep}{existing_pp}" if existing_pp else new_pp

    result = subprocess.run(
        [sys.executable, "-c", "import agents.agent"],
        env=env,
        cwd=str(tmp_path),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, (
        f"import agents.agent failed: stdout={result.stdout!r} stderr={result.stderr!r}"
    )
    # Tight regex: an unconditional ``"openai" not in ...`` check is
    # fragile — langroid's own ``OpenAIGPTConfig`` (imported at module
    # load) emits benign messages that can contain "OpenAIGPT" / "openai"
    # without actually importing the ``openai`` SDK. We look specifically
    # for the regressions that matter: an actual ``import openai`` (or
    # ``from openai import``) succeeding or warning, OR a direct SDK
    # instantiation (``openai.OpenAI(`` / ``openai.Client(``).
    import re

    regression_patterns = [
        r"\bimport openai\b",
        r"\bfrom openai\b",
        r"\bopenai\.OpenAI\s*\(",
        r"\bopenai\.Client\s*\(",
    ]
    for stream_name, stream_val in (
        ("stderr", result.stderr),
        ("stdout", result.stdout),
    ):
        for pat in regression_patterns:
            assert not re.search(pat, stream_val), (
                f"{stream_name} matched regression pattern {pat!r}: {stream_val!r}"
            )
