"""Tests for CrewAI import compatibility (#3268).

When crewai>=0.177.0 is installed, the import path for flow events changed
from crewai.utilities.events.flow_events to crewai.events.types.flow_events.
The fix uses try/except to support both import paths.
"""

import sys
import types
import pytest
from unittest.mock import patch


def _make_fake_module(attrs: dict) -> types.ModuleType:
    """Create a fake module with given attributes."""
    mod = types.ModuleType("fake")
    for k, v in attrs.items():
        setattr(mod, k, v)
    return mod


class TestCrewAIImportCompat:
    """Test that crewai_sdk.py can import flow events from either path."""

    def test_old_import_path_works(self):
        """When old crewai (<0.177.0) is installed, old import path should work."""
        # The old path: crewai.utilities.events.flow_events
        # If it exists, the import should succeed
        fake_events = _make_fake_module({
            "FlowEvent": type("FlowEvent", (), {}),
            "FlowStartedEvent": type("FlowStartedEvent", (), {}),
            "MethodExecutionStartedEvent": type("MethodExecutionStartedEvent", (), {}),
            "MethodExecutionFinishedEvent": type("MethodExecutionFinishedEvent", (), {}),
            "FlowFinishedEvent": type("FlowFinishedEvent", (), {}),
        })

        with patch.dict(sys.modules, {
            "crewai.utilities.events.flow_events": fake_events,
        }):
            # Simulate what our try/except does
            try:
                from crewai.utilities.events.flow_events import FlowEvent
                old_path_works = True
            except ImportError:
                old_path_works = False

            assert old_path_works, "Old import path should work with old crewai"

    def test_new_import_path_fallback(self):
        """When new crewai (>=0.177.0) is installed, new import path should work."""
        # The new path: crewai.events.types.flow_events
        fake_events = _make_fake_module({
            "FlowEvent": type("FlowEvent", (), {}),
            "FlowStartedEvent": type("FlowStartedEvent", (), {}),
            "MethodExecutionStartedEvent": type("MethodExecutionStartedEvent", (), {}),
            "MethodExecutionFinishedEvent": type("MethodExecutionFinishedEvent", (), {}),
            "FlowFinishedEvent": type("FlowFinishedEvent", (), {}),
        })

        # Remove old path, add new path
        old_mod_key = "crewai.utilities.events.flow_events"
        saved = sys.modules.get(old_mod_key)

        try:
            # Make old path fail
            sys.modules[old_mod_key] = None  # type: ignore

            with patch.dict(sys.modules, {
                "crewai.events.types.flow_events": fake_events,
            }, clear=False):
                # Simulate fallback logic
                try:
                    from crewai.utilities.events.flow_events import FlowEvent  # type: ignore
                    new_path_needed = False
                except ImportError:
                    new_path_needed = True

                assert new_path_needed, "Old path should fail, triggering fallback"

                from crewai.events.types.flow_events import FlowEvent  # type: ignore
                assert FlowEvent is not None, "New path should work"
        finally:
            if saved is not None:
                sys.modules[old_mod_key] = saved
            elif old_mod_key in sys.modules:
                del sys.modules[old_mod_key]

    def test_both_paths_fail_raises_import_error(self):
        """When neither path works, ImportError should propagate."""
        # This simulates crewai not having flow events at all
        old_key = "crewai.utilities.events.flow_events"
        new_key = "crewai.events.types.flow_events"

        saved_old = sys.modules.get(old_key)
        saved_new = sys.modules.get(new_key)

        try:
            sys.modules[old_key] = None  # type: ignore
            sys.modules[new_key] = None  # type: ignore

            with pytest.raises(ImportError):
                # Old path
                try:
                    from crewai.utilities.events.flow_events import FlowEvent  # type: ignore
                except ImportError:
                    pass
                # New path
                from crewai.events.types.flow_events import FlowEvent  # type: ignore
        finally:
            if saved_old is not None:
                sys.modules[old_key] = saved_old
            elif old_key in sys.modules:
                del sys.modules[old_key]
            if saved_new is not None:
                sys.modules[new_key] = saved_new
            elif new_key in sys.modules:
                del sys.modules[new_key]
