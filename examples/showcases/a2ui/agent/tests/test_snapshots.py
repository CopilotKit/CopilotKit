"""Regression coverage for incremental Express snapshots across programs."""

import pytest
from research_desk.transport import _Snapshots, prepare_express_input
from test_transport import make_input


def snapshots():
    _, compiler = prepare_express_input(make_input())
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
    deleted = state.compile('deleteSurface("old")', final=True)
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


def test_new_surface_waits_for_root_without_losing_prefix_components_or_data():
    state = snapshots()
    prefix = 'surface("s")\n$/label = "Hello"\nlabel = Text(text=$/label)\n'
    assert state.compile(prefix) == []
    result = state.compile(prefix + 'root = Text(text="Ready")', final=True)
    assert len(result) == 1
    created = result[0]["createSurface"]
    assert created["surfaceId"] == "s"
    assert created["dataModel"] == {"label": "Hello"}
    assert created["components"] == [
        {"id": "label", "component": "Text", "text": {"@path": "/label"}},
        {"id": "root", "component": "Text", "text": "Ready"},
    ]


def test_known_surface_streams_component_and_data_updates_without_root():
    incoming = make_input()
    incoming.forwarded_props["copilotkit"]["ui"]["metadata"]["extensions"][
        "copilotkit_surfaces"
    ] = {"s": {}}
    _, compiler = prepare_express_input(incoming)
    state = _Snapshots(compiler)
    source = (
        'surface("s", update=true)\nlabel = Text(text="Updated")\n$/label = "Updated"'
    )
    result = state.compile(source)
    assert [next(key for key in op if key != "version") for op in result] == [
        "updateComponents",
        "updateDataModel",
    ]
    assert result[0]["updateComponents"]["components"][0]["text"] == "Updated"
    assert result[1]["updateDataModel"]["value"] == {"label": "Updated"}
    assert state.compile(source, final=True) == []


@pytest.mark.parametrize(
    "source",
    [
        'surface("missing")\nlabel = Text(text="Hello")',
        'surface("missing", update=true)\n$/label = "Hello"',
    ],
)
def test_final_update_to_unknown_surface_reports_error_instead_of_disappearing(source):
    state = snapshots()
    assert state.compile(source) == []
    with pytest.raises(ValueError, match="missing.*createSurface"):
        state.compile(source, final=True)


def test_deleted_surface_waits_for_recreation_before_more_updates():
    state = snapshots()
    program(state, 'surface("s")\nroot = Text(text="Old")')
    prefix = 'deleteSurface("s")\nsurface("s")\n$/label = "New"\n'
    state.begin()
    assert state.compile(prefix) == []
    result = state.compile(prefix + "root = Text(text=$/label)", final=True)
    assert len(result) == 2
    assert result[0] == {"version": "v1.0", "deleteSurface": {"surfaceId": "s"}}
    assert result[1]["createSurface"]["dataModel"] == {"label": "New"}


def test_failed_final_program_does_not_remember_an_unemitted_create():
    state = snapshots()
    with pytest.raises(ValueError, match="missing.*createSurface"):
        program(
            state,
            'surface("s")\nroot = Text(text="Ready")\n'
            'surface("missing", update=true)\n$/label = "Hello"',
        )
    result = program(state, 'surface("s")\nroot = Text(text="Ready")')
    assert len(result) == 1
    assert "createSurface" in result[0]


def test_invalid_partial_batch_does_not_emit_destructive_effects():
    state = snapshots()
    source = 'deleteSurface("old")\nsurface("new")\nroot = Text("Ready")\n'
    assert state.compile(source) == []
    assert state.compile(source + "bad = Text(") == []
    with pytest.raises(ValueError):
        state.compile(source + "bad = Text(", final=True)
    assert state.created == set()
    assert state.previous_operations == {}


def test_update_graph_validates_against_previous_components():
    incoming = make_input()
    incoming.forwarded_props["copilotkit"]["ui"]["v1.0"]["inlineCatalogs"][0][
        "components"
    ]["Column"] = {
        "props": {"type": "object", "properties": {}},
        "slots": {"children": "multiple"},
    }
    _, compiler = prepare_express_input(incoming)
    state = _Snapshots(compiler)
    program(
        state, 'surface("s")\nroot = Column(children=["label"])\nlabel = Text("Ready")'
    )
    valid = program(state, 'surface("s", update=true)\nlabel = Text("Changed")')
    assert valid[0]["updateComponents"]["components"][0]["text"] == "Changed"
    with pytest.raises(ValueError):
        program(state, 'surface("s", update=true)\nroot = Column(children=["missing"])')
    assert state.components["s"]["root"]["children"] == ["label"]


def test_nested_component_identities_remain_stable_across_updates():
    incoming = make_input()
    incoming.forwarded_props["copilotkit"]["ui"]["v1.0"]["inlineCatalogs"][0][
        "components"
    ]["Column"] = {
        "props": {"type": "object", "properties": {}},
        "slots": {"children": "multiple"},
    }
    _, compiler = prepare_express_input(incoming)
    state = _Snapshots(compiler)
    first = program(state, 'surface("s")\nroot = Column([Text("A"), Text("B")])')
    ids = [node["id"] for node in first[0]["createSurface"]["components"]]
    second = program(state, 'surface("s")\nroot = Column([Text("A"), Text("Changed")])')
    assert [node["id"] for node in second[0]["updateComponents"]["components"]] == [
        ids[-1]
    ]


def test_partial_prior_surface_stays_partial_after_updating_its_root():
    incoming = make_input()
    extensions = incoming.forwarded_props["copilotkit"]["ui"]["metadata"]["extensions"]
    extensions["copilotkit_surfaces"] = {"s": {"target": "notes"}}
    catalog = incoming.forwarded_props["copilotkit"]["ui"]["v1.0"]["inlineCatalogs"][0]
    catalog["components"]["Column"] = {
        "props": {"type": "object", "properties": {}},
        "slots": {"children": "multiple"},
    }
    _, compiler = prepare_express_input(incoming)
    state = _Snapshots(compiler)
    program(state, 'surface("s", update=true)\nroot = Column(children=["old"])')
    result = program(state, 'surface("s", update=true)\nlabel = Text("Changed")')
    assert result[0]["updateComponents"]["components"][0]["text"] == "Changed"
