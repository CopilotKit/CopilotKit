from importlib.metadata import version
from inspect import signature


def test_alpha_stack_and_native_surface(monkeypatch, tmp_path):
    # CrewAI initializes its local data directory while importing. Keep this
    # package contract test hermetic instead of writing to the developer's
    # macOS Application Support directory.
    monkeypatch.setattr(
        "crewai_core.paths.appdirs.user_data_dir",
        lambda *_args, **_kwargs: str(tmp_path / "crewai-data"),
    )

    assert version("ag-ui-crewai") == "0.0.0.dev1785927675"
    assert version("ag-ui-protocol") == "0.0.0.dev1785927675"
    assert version("crewai") == "1.15.8"
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
