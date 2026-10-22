"""Positional Express must mean the same thing as the corresponding named call."""

from copy import deepcopy

import pytest

from src.express import ExpressCompiler, _component


@pytest.mark.parametrize(
    "name,order,props,slots,events,positional,named,expected",
    [
        (
            "Text",
            ["text"],
            {"color": {"type": "string"}, "text": {"type": "string"}},
            {},
            {},
            'Text("Hello", color="red")',
            'Text(text="Hello", color="red")',
            {"text": "Hello", "color": "red"},
        ),
        (
            "Column",
            ["children"],
            {"gap": {"type": "number"}},
            {"children": "multiple"},
            {},
            "Column([], gap=4)",
            "Column(children=[], gap=4)",
            {"children": [], "gap": 4},
        ),
        (
            "Button",
            ["label", "onClick"],
            {"checks": {"type": "array"}, "label": {"type": "string"}},
            {},
            {"onClick": {}},
            'Button("Save", Event("save"))',
            'Button(label="Save", onClick=Event("save"))',
            {"label": "Save"},
        ),
        (
            "TextField",
            ["label", "value"],
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
            ["data", "xKey", "series"],
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
    name, order, props, slots, events, positional, named, expected
):
    envelope = {
        "v1.0": {
            "inlineCatalogs": [
                {
                    "catalogId": "acme/custom",
                    "components": {
                        name: {
                            "parameterOrder": order,
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


def test_received_order_changes_only_key_order_and_leaves_input_untouched():
    entry = {
        "props": {
            "type": "object",
            "properties": {"color": {"type": "string"}, "text": {"type": "string"}},
            "required": ["text"],
        },
        "slots": {"children": "multiple"},
    }
    original = deepcopy(entry)
    before = _component(entry)
    ordered = _component({**entry, "parameterOrder": ["text", "children"]})
    assert ordered == before
    assert list(ordered["properties"]) == ["text", "children", "color"]
    assert list(before["properties"]) == ["color", "text", "children"]
    assert entry == original


@pytest.mark.parametrize(
    "order", [None, "text", ["missing"], ["text", "text"], [1], [{}]]
)
def test_invalid_received_order_fails_loudly(order):
    with pytest.raises(ValueError, match="parameterOrder"):
        _component(
            {
                "props": {"type": "object", "properties": {"text": {}}},
                "parameterOrder": order,
            }
        )
