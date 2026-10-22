"""Positional Express must mean the same thing as the corresponding named call."""

from copy import deepcopy

import pytest

from src.express import ExpressCompiler, _component
from src.parameter_order import order_parameters


@pytest.mark.parametrize(
    "name,props,slots,events,positional,named,expected",
    [
        (
            "Text",
            {"color": {"type": "string"}, "text": {"type": "string"}},
            {},
            {},
            'Text("Hello", color="red")',
            'Text(text="Hello", color="red")',
            {"text": "Hello", "color": "red"},
        ),
        (
            "Column",
            {"gap": {"type": "number"}},
            {"children": "multiple"},
            {},
            "Column([], gap=4)",
            "Column(children=[], gap=4)",
            {"children": [], "gap": 4},
        ),
        (
            "Button",
            {"checks": {"type": "array"}, "label": {"type": "string"}},
            {},
            {"onClick": {}},
            'Button("Save", Event("save"))',
            'Button(label="Save", onClick=Event("save"))',
            {"label": "Save"},
        ),
        (
            "TextField",
            {
                "checks": {"type": "array"},
                "value": {"type": "string"},
                "label": {"type": "string"},
            },
            {},
            {},
            'TextField("Email", $/email)',
            'TextField(label="Email", value=$/email)',
            {"label": "Email", "value": {"@path": "/email"}},
        ),
        (
            "Chart",
            {
                "chartType": {"type": "string"},
                "data": {"type": "array"},
                "xKey": {"type": "string"},
                "series": {"type": "array"},
            },
            {},
            {},
            'Chart([], "month", ["revenue"], chartType="line")',
            'Chart(data=[], xKey="month", series=["revenue"], chartType="line")',
            {"data": [], "xKey": "month"},
        ),
    ],
)
def test_positional_and_named_calls_compile_identically(
    name, props, slots, events, positional, named, expected
):
    envelope = {
        "v1.0": {
            "inlineCatalogs": [
                {
                    "catalogId": "copilotkit/standard@1",
                    "components": {
                        name: {
                            "props": {"type": "object", "properties": props},
                            "slots": slots,
                            "events": events,
                        }
                    },
                }
            ]
        }
    }
    compiler = ExpressCompiler(envelope)

    def render(call):
        return compiler.compile("root = " + call, final=True)[0]["createSurface"][
            "components"
        ]

    assert render(positional) == render(named)
    assert expected.items() <= render(positional)[0].items()


def test_order_changes_only_key_order_and_preserves_custom_catalogs():
    entry = {
        "props": {
            "type": "object",
            "properties": {"color": {"type": "string"}, "text": {"type": "string"}},
            "required": ["text"],
        },
        "slots": {"children": "multiple"},
    }
    schema = _component(entry)
    original = deepcopy(schema)
    ordered = order_parameters("copilotkit/standard@1", "Text", schema)
    assert ordered == original
    assert list(ordered["properties"]) == ["text", "children", "color"]
    assert schema == original and list(schema["properties"]) == [
        "color",
        "text",
        "children",
    ]
    assert order_parameters("acme/custom", "Text", schema) is schema
    assert order_parameters("copilotkit/standard@1", "NewComponent", schema) is schema


def test_primary_action_precedes_presentation_and_secondary_events():
    schema = {
        "properties": {
            key: {}
            for key in [
                "background",
                "disabled",
                "href",
                "children",
                "onVisible",
                "onClick",
            ]
        }
    }
    ordered = order_parameters("copilotkit/standard@1", "Pressable", schema)
    assert list(ordered["properties"]) == [
        "children",
        "onClick",
        "href",
        "disabled",
        "onVisible",
        "background",
    ]
