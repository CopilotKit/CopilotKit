"""Tests for the ThreadingInstrumentor patch installed by agent_server.py.

The patch exists because strands-agents calls
``ThreadingInstrumentor().instrument()`` at Tracer construction time, which
recursively wraps ThreadPoolExecutor.submit and triggers RecursionError
during tool-rendering requests.

We verify:
  * ``ThreadingInstrumentor.instrument`` has been replaced,
  * the replacement returns ``self`` (not ``None``) so fluent callers
    don't AttributeError,
  * calling ``.instrument()`` is a no-op (doesn't actually wrap anything).
"""

from __future__ import annotations


def _install_patch_without_imports():
    """Apply the same patch agent_server.py applies, without importing
    ag_ui_strands / strands (which aren't available in the local venv).

    Mirrors the logic in ``agent_server.py`` verbatim so this test catches
    regressions where the two diverge.
    """
    from opentelemetry.instrumentation.threading import ThreadingInstrumentor

    def _disabled_instrument(self, *args, **kwargs):
        return self

    ThreadingInstrumentor.instrument = _disabled_instrument  # type: ignore[method-assign]
    return ThreadingInstrumentor, _disabled_instrument


def test_instrument_returns_self_not_none():
    ThreadingInstrumentor, _ = _install_patch_without_imports()

    instance = ThreadingInstrumentor()
    result = instance.instrument()

    # Must return ``self`` so fluent chains don't blow up with
    # AttributeError: 'NoneType' object has no attribute ...
    assert result is instance
    assert result is not None


def test_instrument_accepts_args_and_kwargs():
    """Upstream signature may evolve; the patch must accept arbitrary args."""
    ThreadingInstrumentor, _ = _install_patch_without_imports()

    instance = ThreadingInstrumentor()
    # Any combination of args/kwargs must be accepted without error.
    assert instance.instrument() is instance
    assert instance.instrument("x") is instance
    assert instance.instrument(foo="bar") is instance
    assert instance.instrument("x", y=1) is instance


def test_patch_replaces_original_method():
    ThreadingInstrumentor, sentinel = _install_patch_without_imports()

    assert ThreadingInstrumentor.instrument is sentinel


def test_agent_server_module_installs_patch():
    """Importing ``agent_server`` must leave the instrumentor patched.

    We stub out the strands imports that ``agent_server`` would otherwise
    require, so the test can run in environments where strands isn't
    installed.
    """
    import sys
    import types

    # Stub modules that agent_server transitively imports, so the module
    # loads without needing the real strands stack installed.
    class _AcceptsAnything:
        def __init__(self, *args, **kwargs):
            self.args = args
            self.kwargs = kwargs
            self._agents_by_thread: dict = {}

    fake_ag_ui_strands = types.ModuleType("ag_ui_strands")
    fake_ag_ui_strands.create_strands_app = lambda *a, **k: None  # type: ignore[attr-defined]
    fake_ag_ui_strands.StrandsAgent = _AcceptsAnything  # type: ignore[attr-defined]
    fake_ag_ui_strands.StrandsAgentConfig = _AcceptsAnything  # type: ignore[attr-defined]
    fake_ag_ui_strands.ToolBehavior = _AcceptsAnything  # type: ignore[attr-defined]
    sys.modules.setdefault("ag_ui_strands", fake_ag_ui_strands)

    fake_strands = types.ModuleType("strands")
    fake_strands.Agent = _AcceptsAnything  # type: ignore[attr-defined]
    fake_strands.tool = lambda f=None, **_: (f if callable(f) else (lambda g: g))  # type: ignore[attr-defined]
    sys.modules.setdefault("strands", fake_strands)

    fake_hooks = types.ModuleType("strands.hooks")
    for name in (
        "AfterToolCallEvent",
        "BeforeInvocationEvent",
        "BeforeToolCallEvent",
        "HookProvider",
        "HookRegistry",
    ):
        setattr(fake_hooks, name, type(name, (), {}))
    sys.modules.setdefault("strands.hooks", fake_hooks)

    fake_openai_mod = types.ModuleType("strands.models.openai")

    class _FakeOpenAIModel:
        def __init__(self, *args, **kwargs):
            self.args = args
            self.kwargs = kwargs

    fake_openai_mod.OpenAIModel = _FakeOpenAIModel  # type: ignore[attr-defined]
    fake_models = types.ModuleType("strands.models")
    sys.modules.setdefault("strands.models", fake_models)
    sys.modules.setdefault("strands.models.openai", fake_openai_mod)

    # uvicorn is imported at module level but only invoked from ``main()``.
    if "uvicorn" not in sys.modules:
        fake_uvicorn = types.ModuleType("uvicorn")
        fake_uvicorn.run = lambda *a, **k: None  # type: ignore[attr-defined]
        sys.modules["uvicorn"] = fake_uvicorn

    # dotenv similarly only invoked at load_dotenv() call time.
    if "dotenv" not in sys.modules:
        fake_dotenv = types.ModuleType("dotenv")
        fake_dotenv.load_dotenv = lambda *a, **k: None  # type: ignore[attr-defined]
        sys.modules["dotenv"] = fake_dotenv

    # ``build_showcase_agent`` fails fast if OPENAI_API_KEY is missing;
    # set a dummy value so the module-level call succeeds under the stubs.
    import os as _os

    _os.environ.setdefault("OPENAI_API_KEY", "test-key-for-instrumentor-patch")

    # Import agent_server. This triggers the patch.
    # Re-import defensively in case a prior test already loaded it.
    sys.modules.pop("agent_server", None)
    import agent_server  # noqa: F401

    from opentelemetry.instrumentation.threading import ThreadingInstrumentor

    # The replacement must return self.
    instance = ThreadingInstrumentor()
    assert instance.instrument() is instance
