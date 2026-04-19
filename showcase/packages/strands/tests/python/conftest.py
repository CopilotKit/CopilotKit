"""Pytest configuration for strands showcase unit tests.

Ensures ``src/`` (so ``agents.agent`` imports) and the shared-python tools
directory are both on ``sys.path``. Mirrors the runtime layout produced by
the Dockerfile (``src/`` → ``WORKDIR``, ``shared_python/`` → ``/app/shared/python``).

Also installs minimal stubs for ``ag_ui_strands`` and ``strands`` so the
unit tests can run in environments where those heavy runtime deps aren't
installed. Tests that need real behavior monkey-patch the specific
symbols they touch.
"""

import os
import sys
import types

_HERE = os.path.dirname(__file__)
_PKG_ROOT = os.path.abspath(os.path.join(_HERE, "..", ".."))

# src/ holds agent_server.py and agents/
sys.path.insert(0, os.path.join(_PKG_ROOT, "src"))
# shared_python/ holds tools/
sys.path.insert(0, os.path.join(_PKG_ROOT, "shared_python"))


class _Permissive:
    """Base stub that accepts any ``__init__`` args and exposes a writable
    ``_agents_by_thread`` attribute so ``build_showcase_agent`` can swap
    the per-thread dict in place."""

    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs
        self._agents_by_thread: dict = {}


def _install_stub_modules() -> None:
    """Install minimal stub modules so ``agents.agent`` can be imported.

    Unit tests only exercise pure-Python logic (cap hook counter, dict
    injection). We stub out strands / ag_ui_strands symbols with plain
    placeholder classes; tests that care about behavior monkey-patch the
    relevant attributes.
    """
    if "ag_ui_strands" not in sys.modules:
        m = types.ModuleType("ag_ui_strands")
        m.StrandsAgent = _Permissive  # type: ignore[attr-defined]
        m.StrandsAgentConfig = _Permissive  # type: ignore[attr-defined]
        m.ToolBehavior = _Permissive  # type: ignore[attr-defined]

        class _FakeFastAPI:
            """Accepts the decorators agent_server applies (``@app.get`` etc.)."""

            def _decorator(self, *a, **k):
                def _wrap(fn):
                    return fn
                return _wrap

            get = post = put = delete = patch = _decorator

        m.create_strands_app = lambda *a, **k: _FakeFastAPI()  # type: ignore[attr-defined]
        sys.modules["ag_ui_strands"] = m

    if "strands" not in sys.modules:
        m = types.ModuleType("strands")
        m.Agent = _Permissive  # type: ignore[attr-defined]

        def _tool_decorator(func=None, **_kwargs):
            if callable(func):
                return func
            def _wrap(f):
                return f
            return _wrap

        m.tool = _tool_decorator  # type: ignore[attr-defined]
        sys.modules["strands"] = m

    if "strands.hooks" not in sys.modules:
        m = types.ModuleType("strands.hooks")
        for name in (
            "AfterToolCallEvent",
            "BeforeInvocationEvent",
            "BeforeToolCallEvent",
            "HookProvider",
            "HookRegistry",
        ):
            setattr(m, name, type(name, (), {}))
        sys.modules["strands.hooks"] = m

    if "strands.models" not in sys.modules:
        sys.modules["strands.models"] = types.ModuleType("strands.models")

    if "strands.models.openai" not in sys.modules:
        m = types.ModuleType("strands.models.openai")
        m.OpenAIModel = _Permissive  # type: ignore[attr-defined]
        sys.modules["strands.models.openai"] = m

    if "uvicorn" not in sys.modules:
        m = types.ModuleType("uvicorn")
        m.run = lambda *a, **k: None  # type: ignore[attr-defined]
        sys.modules["uvicorn"] = m

    if "dotenv" not in sys.modules:
        m = types.ModuleType("dotenv")
        m.load_dotenv = lambda *a, **k: None  # type: ignore[attr-defined]
        sys.modules["dotenv"] = m


_install_stub_modules()
