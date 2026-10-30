"""Format validation must reject unsupported releases before a model call."""

import pytest
from agents import a2ui_format


def test_express_requires_adapter_capability(monkeypatch):
    monkeypatch.setattr(
        a2ui_format.ag_ui_adk, "compile_a2ui_express", None, raising=False
    )
    with pytest.raises(RuntimeError, match="release-blocked"):
        a2ui_format.validate_format("express")
    assert a2ui_format.validate_format("direct_json") == "direct_json"


def test_format_rejects_unknown_values():
    with pytest.raises(ValueError, match="express.*direct_json"):
        a2ui_format.validate_format("json")


def test_request_format_is_scoped_and_malformed_properties_are_rejected():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    app.add_middleware(a2ui_format.A2UIFormatMiddleware)

    @app.post("/a2ui_fixed_schema")
    async def read_format():
        return {"format": a2ui_format.inference_format.get()}

    client = TestClient(app)
    assert client.post(
        "/a2ui_fixed_schema",
        json={"forwardedProps": {"a2ui": {"inferenceFormat": "direct_json"}}},
    ).json() == {"format": "direct_json"}
    assert (
        client.post(
            "/a2ui_fixed_schema", json={"forwardedProps": {"a2ui": None}}
        ).status_code
        == 400
    )
    assert a2ui_format.inference_format.get() == "express"
