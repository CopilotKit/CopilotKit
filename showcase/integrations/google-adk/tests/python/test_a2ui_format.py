"""Format validation must reject unknown formats before a model call."""

import pytest
from agents import a2ui_format


def test_both_formats_are_accepted():
    assert a2ui_format.validate_format("express") == "express"
    assert a2ui_format.validate_format("direct_json") == "direct_json"


def test_format_rejects_unknown_values():
    with pytest.raises(ValueError, match="express.*direct_json"):
        a2ui_format.validate_format("json")


def test_request_format_is_scoped_and_malformed_properties_are_rejected():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    app.add_middleware(a2ui_format.A2UIFormatMiddleware, routes={"/a2ui_fixed_schema"})

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


def test_null_forwarded_props_uses_the_default_but_other_shapes_are_rejected():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    app.add_middleware(a2ui_format.A2UIFormatMiddleware, routes={"/a2ui_fixed_schema"})

    @app.post("/a2ui_fixed_schema")
    async def read_format():
        return {"format": a2ui_format.inference_format.get()}

    client = TestClient(app)
    assert client.post("/a2ui_fixed_schema", json={"forwardedProps": None}).json() == {
        "format": "express"
    }
    for value in [[], "", False, 0]:
        assert (
            client.post(
                "/a2ui_fixed_schema", json={"forwardedProps": value}
            ).status_code
            == 400
        )


def test_format_routes_are_supplied_by_the_registry_wiring():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    app.add_middleware(a2ui_format.A2UIFormatMiddleware, routes={"/renamed"})

    @app.post("/renamed")
    async def read_format():
        return {"format": a2ui_format.inference_format.get()}

    client = TestClient(app)
    assert client.post(
        "/renamed",
        json={"forwardedProps": {"a2ui": {"inferenceFormat": "direct_json"}}},
    ).json() == {"format": "direct_json"}
    assert a2ui_format.inference_format.get() == "express"
