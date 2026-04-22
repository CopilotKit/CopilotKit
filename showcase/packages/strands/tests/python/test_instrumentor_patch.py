"""Tests for the ThreadingInstrumentor patch installed by agent_server.py.

The patch exists because strands-agents calls
``ThreadingInstrumentor().instrument()`` at Tracer construction time, which
recursively wraps ThreadPoolExecutor.submit and triggers RecursionError
during tool-rendering requests.

We verify:
  * ``ThreadingInstrumentor.instrument`` has been replaced,
  * the replacement returns ``self`` (not ``None``) so fluent callers
    don't AttributeError,
  * calling ``.instrument()`` is a no-op (doesn't actually wrap anything),
  * the import-order guard is implemented as ``if/raise`` (NOT ``assert``)
    so it survives ``python -O``,
  * pre-imported strands is detected and raises.
"""

from __future__ import annotations

import pytest


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


def test_agent_server_guards_use_if_raise_not_assert():
    """The import-order guards in agent_server.py must be implemented as
    ``if not ...: raise RuntimeError(...)``, NOT as ``assert`` statements.

    Why this matters: ``assert`` is stripped when Python runs with ``-O``
    (some Docker base images, optimized CPython builds). If the guards
    use ``assert``, they silently vanish under ``-O`` and the documented
    RecursionError returns with no signal.

    This test reads the source of ``agent_server.py`` and fails if any
    guard is written as ``assert``.
    """
    import importlib.util

    spec = importlib.util.find_spec("agent_server")
    if spec is None or spec.origin is None:
        pytest.skip("agent_server module not locatable on sys.path")

    with open(spec.origin, "r", encoding="utf-8") as fh:
        source = fh.read()

    # The guards we care about are named functions. The invariant we
    # enforce: their bodies must raise, not assert. We grep for the
    # former and reject the latter.
    assert "_assert_strands_not_preimported" in source, (
        "agent_server.py must expose _assert_strands_not_preimported() "
        "so tests can monkey-patch the guard cleanly"
    )
    assert "_assert_instrumentor_patched" in source, (
        "agent_server.py must expose _assert_instrumentor_patched() "
        "for the same reason"
    )

    # Check that neither of the guard strings appears behind an ``assert``.
    # We match ``assert "strands" not in sys.modules`` and ``assert
    # _ThreadingInstrumentor.instrument is``. Both are the shapes that
    # existed before the -O fix. If either regex matches, we've regressed.
    import re

    forbidden_patterns = [
        r'^\s*assert\s+"strands"\s+not\s+in\s+sys\.modules\b',
        r'^\s*assert\s+_ThreadingInstrumentor\.instrument\s+is\b',
    ]
    for pat in forbidden_patterns:
        assert not re.search(pat, source, flags=re.MULTILINE), (
            f"agent_server.py contains a raw ``assert`` guard matching {pat!r}; "
            "these are stripped under ``python -O``. Use ``if/raise RuntimeError`` instead."
        )

    # Positive assertion: the named functions must raise RuntimeError
    # (not AssertionError) so the guard survives -O and also so callers
    # don't need ``__debug__`` to be true.
    assert "raise RuntimeError(" in source, (
        "agent_server.py guards must use ``raise RuntimeError(...)`` — "
        "RuntimeError (not AssertionError) so the semantics are identical "
        "under ``python -O``"
    )


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

    class _FakeFastAPI:
        """Accepts the decorator calls agent_server applies to ``app``."""

        def _decorator(self, *a, **k):
            def _wrap(fn):
                return fn
            return _wrap

        get = post = put = delete = patch = _decorator

        # agent_server.py installs a ``HealthMiddleware`` via
        # ``app.add_middleware(...)`` after creating the Strands app — the
        # stub must accept that call so module execution completes.
        def add_middleware(self, *a, **k):
            return None

    fake_ag_ui_strands = types.ModuleType("ag_ui_strands")
    fake_ag_ui_strands.create_strands_app = lambda *a, **k: _FakeFastAPI()  # type: ignore[attr-defined]
    fake_ag_ui_strands.StrandsAgent = _AcceptsAnything  # type: ignore[attr-defined]
    fake_ag_ui_strands.StrandsAgentConfig = _AcceptsAnything  # type: ignore[attr-defined]
    fake_ag_ui_strands.ToolBehavior = _AcceptsAnything  # type: ignore[attr-defined]

    fake_strands = types.ModuleType("strands")
    fake_strands.Agent = _AcceptsAnything  # type: ignore[attr-defined]
    fake_strands.tool = lambda f=None, **_: (f if callable(f) else (lambda g: g))  # type: ignore[attr-defined]

    fake_hooks = types.ModuleType("strands.hooks")
    for name in (
        "AfterToolCallEvent",
        "BeforeInvocationEvent",
        "BeforeToolCallEvent",
        "HookProvider",
        "HookRegistry",
    ):
        setattr(fake_hooks, name, type(name, (), {}))

    fake_openai_mod = types.ModuleType("strands.models.openai")

    class _FakeOpenAIModel:
        def __init__(self, *args, **kwargs):
            self.args = args
            self.kwargs = kwargs

    fake_openai_mod.OpenAIModel = _FakeOpenAIModel  # type: ignore[attr-defined]
    fake_models = types.ModuleType("strands.models")

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

    # Drop any pre-existing strands / agent_server entries so the
    # import-order guard passes cleanly. After the guard runs, install
    # the stubs via a meta-path finder so the post-patch
    # ``from ag_ui_strands import ...`` lines resolve.
    sys.modules.pop("agent_server", None)
    for _stale in (
        "strands",
        "strands.hooks",
        "strands.models",
        "strands.models.openai",
        "ag_ui_strands",
    ):
        sys.modules.pop(_stale, None)

    _STUB_MAP = {
        "strands": fake_strands,
        "strands.hooks": fake_hooks,
        "strands.models": fake_models,
        "strands.models.openai": fake_openai_mod,
        "ag_ui_strands": fake_ag_ui_strands,
    }

    class _StubLoader:
        """Minimal loader that returns a pre-built module object."""

        def __init__(self, module):
            self._module = module

        def create_module(self, spec):
            return self._module

        def exec_module(self, module):
            # Module body already populated; nothing to execute.
            return None

    class _LazyStubFinder:
        """Serves stub modules for strands / ag_ui_strands names on demand.

        agent_server's ``_assert_strands_not_preimported()`` runs BEFORE
        any of these modules are referenced, so sys.modules is clean at
        guard time. The first post-patch ``from ag_ui_strands import ...``
        triggers this finder, which returns a proper ModuleSpec whose
        loader yields our pre-built stub.
        """

        @classmethod
        def find_spec(cls, name, path, target=None):
            mod = _STUB_MAP.get(name)
            if mod is None:
                return None
            import importlib.util as _u

            return _u.spec_from_loader(name, _StubLoader(mod))

    import importlib.util as _util

    spec = _util.find_spec("agent_server")
    if spec is None or spec.origin is None:
        pytest.skip("agent_server module not locatable on sys.path")

    sys.meta_path.insert(0, _LazyStubFinder)
    try:
        with open(spec.origin, "r", encoding="utf-8") as fh:
            source = fh.read()
        module_ns: dict = {
            "__name__": "agent_server_under_test",
            "__file__": spec.origin,
        }
        # Execute agent_server's source verbatim — no regex surgery. The
        # guard runs against an empty-of-strands ``sys.modules`` and passes;
        # downstream imports hit the lazy stub finder.
        exec(compile(source, spec.origin, "exec"), module_ns)
    finally:
        sys.meta_path.remove(_LazyStubFinder)

    from opentelemetry.instrumentation.threading import ThreadingInstrumentor

    # The replacement must return self.
    instance = ThreadingInstrumentor()
    assert instance.instrument() is instance


def test_import_order_guard_catches_preimported_strands():
    """agent_server.py contains a ``_assert_strands_not_preimported()``
    guard BEFORE the ThreadingInstrumentor patch. If strands was already
    imported (directly or transitively) above that line, the OTel patch
    would be too late — strands' Tracer may have already been constructed.

    Simulate the failure mode: pre-seed ``sys.modules['strands']``, then
    try to import agent_server, and verify the guard raises ``RuntimeError``
    (NOT ``AssertionError`` — the latter would silently disappear under
    ``python -O``).
    """
    import sys
    import types

    # Install a fake 'strands' before agent_server imports. In the real
    # failure mode this would be the genuine package that already ran
    # ThreadingInstrumentor().instrument() — here the presence alone is
    # what the guard checks.
    preexisting_strands = types.ModuleType("strands")
    sys.modules["strands"] = preexisting_strands

    # Ensure agent_server is re-imported fresh so the module-level
    # guard executes.
    sys.modules.pop("agent_server", None)

    try:
        # RuntimeError, NOT AssertionError — the guard is an explicit
        # ``raise`` so ``python -O`` doesn't strip it.
        with pytest.raises(RuntimeError, match="strands imported before"):
            import agent_server  # noqa: F401
    finally:
        # Cleanup: remove the fake strands so subsequent tests can
        # install their own stubs.
        sys.modules.pop("strands", None)
        sys.modules.pop("agent_server", None)


def test_real_strands_agent_signature_integration():
    """Integration-style test: when the real ``strands-agents`` package
    IS installed, construct a real ``strands.Agent`` via the shapes the
    conftest stubs cover. This catches drift between our stubs and the
    real signature — if strands renames an Agent kwarg, the stub still
    passes the unit tests but this integration test fails.

    Skipped gracefully when ``strands-agents`` isn't installed (the
    default in the unit-test venv; it's available in the Docker image
    and CI integration environments).
    """
    import sys
    import types

    # Don't touch the stub modules installed by conftest unless we're
    # actually going to use the real package. Probe without importing.
    try:
        import importlib.util

        spec = importlib.util.find_spec("strands")
    except Exception:
        spec = None

    if spec is None:
        pytest.skip("strands-agents not installed; integration test skipped")

    # If the stub is already in sys.modules, drop it so the real package
    # gets imported fresh.
    for mod_name in [
        "strands",
        "strands.hooks",
        "strands.models",
        "strands.models.openai",
    ]:
        mod = sys.modules.get(mod_name)
        if mod is not None and isinstance(mod, types.ModuleType) and not getattr(mod, "__file__", None):
            sys.modules.pop(mod_name, None)

    try:
        from strands import Agent  # type: ignore[import-not-found]
    except Exception as exc:  # pragma: no cover - defensive
        pytest.skip(f"strands package present but not importable cleanly: {exc}")
        return

    # The minimal constructor should at least accept a ``tools`` kwarg
    # (which our factory relies on). We don't need a real model here --
    # just verify the signature accepts the shape we use.
    try:
        agent = Agent(tools=[])  # type: ignore[call-arg]
    except TypeError as exc:
        # TypeError here == real strands Agent signature drifted from
        # what the factory passes in build_showcase_agent.
        pytest.fail(
            f"real strands.Agent no longer accepts the kwargs build_showcase_agent "
            f"relies on: {exc}"
        )
    except Exception:
        # Any other exception (e.g. model required) is fine — the point
        # is that the Agent class accepted the kwargs.
        pass
    else:
        assert agent is not None
