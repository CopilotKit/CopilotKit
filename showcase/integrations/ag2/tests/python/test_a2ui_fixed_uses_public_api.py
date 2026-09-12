import inspect

from agents import a2ui_fixed


def test_version_comes_from_ag2_public_constants():
    src = inspect.getsource(a2ui_fixed)
    assert "A2UI_DEFAULT_VERSION" in src, "use ag2's public version constant"
    assert 'A2UI_VERSION = "v0.9"' not in src, "do not hardcode the protocol version"


def test_no_private_ag2_imports():
    src = inspect.getsource(a2ui_fixed)
    assert "_types" not in src, "example code must not import ag2 private modules"


def test_operations_shape_unchanged():
    import asyncio, dataclasses

    ops = asyncio.run(a2ui_fixed.display_flight("SFO", "JFK", "United", "$289"))
    payload = dataclasses.asdict(ops)["a2ui_operations"]
    assert [next(k for k in o if k != "version") for o in payload] == [
        "createSurface",
        "updateComponents",
        "updateDataModel",
    ]
    assert all(o["version"] == "v0.9" for o in payload)
