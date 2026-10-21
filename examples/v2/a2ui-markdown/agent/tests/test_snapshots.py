"""Regression coverage for incremental Express snapshots across programs."""

import pytest
from test_transport import make_input

from src.transport import _Snapshots, prepare_express_input


def snapshots():
    _, compiler = prepare_express_input(make_input(), "markdown")
    return _Snapshots(compiler)


def program(state, source):
    state.begin()
    return state.compile(source, final=True)


def test_explicit_component_update_does_not_hide_a_later_revert():
    state = snapshots()
    program(state, 'surface("s")\nroot = Text("A")')
    program(state, 'surface("s", update=true)\nroot = Text("B")')
    result = program(state, 'surface("s")\nroot = Text("A")')
    assert result == [
        {
            "version": "v1.0",
            "updateComponents": {
                "surfaceId": "s",
                "components": [{"id": "root", "component": "Text", "text": "A"}],
            },
        }
    ]


@pytest.mark.parametrize("path", ["/value", "/nested/value", "/"])
def test_explicit_data_update_does_not_hide_a_later_revert(path):
    state = snapshots()
    source = 'surface("s")\nroot = Text("A")\n$/value = 1\n$/nested/value = 2'
    program(state, source)
    program(state, f'surface("s", update=true)\n${path} = null')
    result = program(state, source)
    assert {
        "version": "v1.0",
        "updateDataModel": {
            "surfaceId": "s",
            "path": "/",
            "value": {"value": 1, "nested": {"value": 2}},
        },
    } in result


def test_incomplete_prefix_does_not_forget_an_emitted_delete():
    state = snapshots()
    deleted = state.compile('deleteSurface("old")')
    assert len(deleted) == 1
    # An unresolved component reference makes this partial snapshot unavailable.
    assert state.compile('deleteSurface("old")\nroot = MissingComponent(') == []
    result = state.compile('deleteSurface("old")\nroot = Text("Ready")', final=True)
    assert not any("deleteSurface" in operation for operation in result)


def test_tiny_chunks_emit_delete_once_and_next_program_can_delete_again():
    state = snapshots()
    source = 'deleteSurface("old")\nsurface("new")\nroot = Text("Ready")'
    emitted = []
    for end in range(1, len(source) + 1):
        emitted.extend(state.compile(source[:end]))
    emitted.extend(state.compile(source, final=True))
    assert sum("deleteSurface" in operation for operation in emitted) == 1
    assert sum("createSurface" in operation for operation in emitted) == 1
    state.begin()
    assert state.compile('deleteSurface("old")', final=True) == [
        {"version": "v1.0", "deleteSurface": {"surfaceId": "old"}},
    ]


def test_recompiling_create_then_explicit_update_does_not_revert_the_update():
    state = snapshots()
    source = (
        'surface("s")\nroot = Text("A")\nsurface("s", update=true)\nroot = Text("B")'
    )
    first = state.compile(source, final=True)
    assert first[-1]["updateComponents"]["components"][0]["text"] == "B"
    assert state.compile(source, final=True) == []
