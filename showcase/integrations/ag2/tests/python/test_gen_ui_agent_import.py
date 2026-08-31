"""Regression test: gen_ui_agent must import/construct without raising.

Reproduces the crash-on-import that took down `showcase-ag2` staging
deploys since 76874f06d. Importing `agents.gen_ui_agent` constructs the
`ConversableAgent` at module scope, which registers `set_steps` as an LLM
tool. AG2 runs every tool parameter through pydantic
`TypeAdapter(param).json_schema()`. When `set_steps` carries
`from __future__ import annotations`, its `context_variables: ContextVariables`
parameter is seen as an unresolved `ForwardRef('ContextVariables')`, and
schema generation raises `pydantic.errors.PydanticUserError` at import time
-> importing this agent module aborts server startup -> the service never
comes up -> the Railway healthcheck (`/health`, owned by the integration's
top-level entrypoint, not this module) fails.

The success criterion mirrors the failed healthcheck: the module imports
cleanly and the agent object (with its registered tools) is built.
"""

import importlib
import os
from pathlib import Path

import pytest


# ConversableAgent construction validates that an LLM config / key is
# present. The crash we are guarding against happens during tool-schema
# generation, which is reached only after that validation, so seed a dummy
# key. No network call is made at import time.
os.environ.setdefault("OPENAI_API_KEY", "test-key-not-used")


def _gen_ui_agent_source_path() -> Path:
    """Resolve src/agents/gen_ui_agent.py relative to this test file.

    This test lives at <integration>/tests/python/, so the integration root
    is two levels up; the source then sits under src/agents/. Resolving via
    __file__ keeps the guard working regardless of where the repo is checked
    out (no hardcoded absolute path).
    """
    integration_root = Path(__file__).resolve().parents[2]
    return integration_root / "src" / "agents" / "gen_ui_agent.py"


def test_gen_ui_agent_source_has_no_future_annotations():
    """The source must NOT carry `from __future__ import annotations`.

    This is the load-bearing regression pin. `from __future__ import
    annotations` makes Python stringify every annotation (PEP 563), so the
    `set_steps` tool's `context_variables: ContextVariables` parameter is seen
    by AG2 as an unresolved `ForwardRef('ContextVariables')`. AG2 runs each
    tool parameter through pydantic `TypeAdapter(param).json_schema()`, which
    then raises `PydanticUserError` at import time -> importing this agent
    module aborts server startup -> the service never comes up -> the
    Railway/staging healthcheck (`/health`, owned by the entrypoint, not this
    module) fails (regression 76874f06d).

    Asserting on the source text (not just "import didn't crash") makes this a
    TRUE guard: it fails the instant someone re-adds the future-import, even if
    a future AG2/pydantic happens to resolve the forward-ref gracefully and the
    import would no longer crash on its own.
    """
    source_path = _gen_ui_agent_source_path()
    assert source_path.is_file(), f"could not locate source at {source_path}"

    offending = "from __future__ import annotations"
    source_lines = source_path.read_text(encoding="utf-8").splitlines()
    matches = [
        f"  line {i}: {line!r}"
        for i, line in enumerate(source_lines, start=1)
        if line.strip() == offending
    ]
    assert not matches, (
        f"{source_path} must NOT contain `{offending}`.\n"
        "PEP 563 stringifies annotations, turning the set_steps tool's "
        "`context_variables: ContextVariables` into an unresolved ForwardRef; "
        "AG2's pydantic tool-schema generation then raises PydanticUserError "
        "at import time, so importing this agent module aborts server startup "
        "and the service never comes up, failing the Railway healthcheck "
        "(`/health`, owned by the entrypoint, not this module) (regression "
        "76874f06d). Remove the future-import.\nFound at:\n" + "\n".join(matches)
    )


def test_gen_ui_agent_imports_without_pydantic_error():
    """Importing the module must not raise PydanticUserError (or anything).

    Proves the crash path is actually clear on the *installed* AG2/pydantic
    (complements the static source guard above, which is version-independent).
    """
    try:
        module = importlib.import_module("agents.gen_ui_agent")
    except Exception:  # noqa: BLE001 - re-raise so the verbatim traceback is kept
        # Let the original exception propagate with its full traceback intact:
        # for a deep pydantic schema-gen crash the verbatim stack IS the
        # load-bearing diagnostic, which a re-wrapped pytest.fail string loses.
        pytest.fail(
            "gen_ui_agent failed to import (see traceback below)",
            pytrace=True,
        )

    # The agent and its ASGI app must be constructed (i.e. tool registration,
    # where the crash occurred, completed).
    assert module.agent is not None
    assert module.gen_ui_agent_app is not None
    # set_steps must be registered as a tool on the agent.
    tool_names = {t.name for t in module.agent.tools}
    assert "set_steps" in tool_names
