from importlib.metadata import version
from inspect import signature


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
