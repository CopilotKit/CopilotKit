from importlib.metadata import version
from inspect import signature
from pathlib import Path
from types import SimpleNamespace

import pytest


AGENT_SERVER = Path(__file__).resolve().parents[2] / "src" / "agent_server.py"


def test_release_stack_and_native_surface(monkeypatch, tmp_path):
    # CrewAI initializes its local data directory while importing. Keep this
    # package contract test hermetic instead of writing to the developer's
    # macOS Application Support directory.
    monkeypatch.setattr(
        "crewai_core.paths.appdirs.user_data_dir",
        lambda *_args, **_kwargs: str(tmp_path / "crewai-data"),
    )

    assert version("ag-ui-crewai") == "0.3.0"
    assert version("ag-ui-protocol") == "0.1.19"
    assert version("crewai") == "1.15.11"
    assert version("litellm") == "1.79.3"

    from ag_ui_crewai import (
        add_crewai_flow_fastapi_endpoint,
        crewai_prepare_inputs,
        get_capabilities,
    )

    assert (
        "emit_interrupt_outcome"
        in signature(add_crewai_flow_fastapi_endpoint).parameters
    )
    assert "forwarded_props" in signature(crewai_prepare_inputs).parameters

    capabilities = get_capabilities()
    assert capabilities["transport"]["streamFrames"] is True
    assert capabilities["wireShape"]["emissionShape"] == "triples"
    assert capabilities["reasoning"]["supported"] is True
    assert capabilities["conversationalFlows"]["supported"] is True


def test_preseed_system_prompt_uses_crewai_1x_chat_inputs():
    import ag_ui_crewai.crews as bridge_crews

    from agents._chat_flow_helpers import preseed_system_prompt

    crew_name = "release_contract_prompt"
    description = "Use this exact showcase system prompt."
    preseed_system_prompt(crew_name, description)

    chat_inputs = bridge_crews.crew_chat_generate_crew_chat_inputs(
        object(), crew_name, object()
    )

    assert chat_inputs.crew_name == crew_name
    assert chat_inputs.crew_description == description
    assert chat_inputs.inputs == []


def test_resume_compat_keeps_cancel_distinct_from_resolved_null(monkeypatch):
    import ag_ui_crewai._hitl as bridge_hitl
    import ag_ui_crewai.endpoint as bridge_endpoint

    from _shared import ag_ui_crewai_compat as compat

    cancelled = SimpleNamespace(
        resume=[
            SimpleNamespace(
                interrupt_id="interrupt-cancelled",
                status="cancelled",
                payload=None,
            )
        ]
    )
    resolved_null = SimpleNamespace(
        resume=[
            SimpleNamespace(
                interrupt_id="interrupt-resolved",
                status="resolved",
                payload=None,
            )
        ]
    )

    hitl_binding_before_test = bridge_hitl.feedback_from_resume
    endpoint_binding_before_test = bridge_endpoint.feedback_from_resume
    with monkeypatch.context() as bridge_bindings:
        bridge_bindings.setattr(
            bridge_hitl,
            "feedback_from_resume",
            compat._original_feedback_from_resume,
        )
        bridge_bindings.setattr(
            bridge_endpoint,
            "feedback_from_resume",
            compat._original_feedback_from_resume,
        )

        compat.install_resume_status_compat()

        assert bridge_hitl.feedback_from_resume is compat._feedback_from_resume
        assert bridge_endpoint.feedback_from_resume is compat._feedback_from_resume
        for feedback_from_resume in (
            bridge_hitl.feedback_from_resume,
            bridge_endpoint.feedback_from_resume,
        ):
            assert feedback_from_resume(resolved_null) == (
                "null",
                "interrupt-resolved",
            )
            assert feedback_from_resume(cancelled) == (
                "",
                "interrupt-cancelled",
            )

    assert bridge_hitl.feedback_from_resume is hitl_binding_before_test
    assert bridge_endpoint.feedback_from_resume is endpoint_binding_before_test


def test_resume_compat_fails_loudly_for_unreviewed_bridge_version(monkeypatch):
    import ag_ui_crewai._hitl as bridge_hitl
    import ag_ui_crewai.endpoint as bridge_endpoint

    from _shared import ag_ui_crewai_compat as compat

    hitl_binding_before_test = bridge_hitl.feedback_from_resume
    endpoint_binding_before_test = bridge_endpoint.feedback_from_resume
    hitl_sentinel = object()
    endpoint_sentinel = object()
    with monkeypatch.context() as bridge_bindings:
        bridge_bindings.setattr(
            bridge_hitl,
            "feedback_from_resume",
            hitl_sentinel,
        )
        bridge_bindings.setattr(
            bridge_endpoint,
            "feedback_from_resume",
            endpoint_sentinel,
        )
        bridge_bindings.setattr(
            compat,
            "package_version",
            lambda _package: "0.4.0",
        )

        with pytest.raises(RuntimeError, match="supports ag-ui-crewai 0.3.0"):
            compat.install_resume_status_compat()

        assert bridge_hitl.feedback_from_resume is hitl_sentinel
        assert bridge_endpoint.feedback_from_resume is endpoint_sentinel

    assert bridge_hitl.feedback_from_resume is hitl_binding_before_test
    assert bridge_endpoint.feedback_from_resume is endpoint_binding_before_test


def test_server_installs_resume_compat_before_registering_endpoints():
    source = AGENT_SERVER.read_text()

    assert source.index("install_resume_status_compat()") < source.index(
        "add_crewai_flow_fastapi_endpoint("
    )
