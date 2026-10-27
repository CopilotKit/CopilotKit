import json

import pytest
from research_desk.express import ExpressCompiler


def envelope():
    return {
        "v1.0": {
            "inlineCatalogs": [
                {
                    "catalogId": "demo",
                    "protocolVersion": "1.0",
                    "components": {
                        "Text": {
                            "props": {
                                "type": "object",
                                "properties": {"text": {"type": "string"}},
                                "required": ["text"],
                            }
                        },
                        "Column": {
                            "props": {"type": "object", "properties": {}},
                            "slots": {"children": "multiple"},
                        },
                        "Button": {
                            "props": {
                                "type": "object",
                                "properties": {"label": {"type": "string"}},
                            },
                            "events": {"onClick": {"parameters": {"type": "object"}}},
                        },
                    },
                    "functions": {
                        "formatCurrency": {
                            "parameters": {
                                "type": "object",
                                "description": "{ value: number; currency: string }",
                            },
                            "returnType": "string",
                        }
                    },
                }
            ]
        }
    }


def test_catalog_instruction_uses_received_props_slots_and_events():
    instructions = ExpressCompiler(envelope()).instructions()
    assert "Text(text)" in instructions
    assert "children" in instructions and "onClick" in instructions
    assert "formatCurrency(value, currency)" in instructions
    assert "<a2ui>" not in instructions


def test_instructions_preserve_nested_literal_contracts_and_validation():
    catalog = envelope()
    # The same shape that rejected an Aral Sea Map's invented description.
    # Use a custom component name so guidance cannot depend on Map hardcoding.
    markers = {
        "type": "array",
        "description": "A list of places",
        "items": {
            "type": "object",
            "properties": {
                "label": {"type": "string"},
                "lat": {"type": "number"},
                "lng": {"type": "number"},
                "category": {"type": "string"},
            },
            "required": ["label", "lat", "lng"],
            "additionalProperties": False,
        },
    }
    center = {
        "anyOf": [
            {"type": "null"},
            {
                "type": "object",
                "properties": {"lat": {"type": "number"}, "lng": {"type": "number"}},
                "required": ["lat", "lng"],
                "additionalProperties": False,
            },
        ]
    }
    catalog["v1.0"]["inlineCatalogs"][0]["components"]["LocationView"] = {
        "props": {
            "type": "object",
            "properties": {"markers": markers, "center": center},
            "additionalProperties": False,
        }
    }
    compiler = ExpressCompiler(catalog)
    instructions = compiler.instructions()
    # Read the machine-readable contracts supplied to the model, and require
    # every nested constraint (not merely the property description) to survive.
    contracts = next(
        json.loads(line)
        for line in instructions.splitlines()
        if line.startswith('{"catalogId":')
    )
    assert contracts["catalogId"] == "demo"
    assert contracts["components"]["LocationView"] == {
        "markers": markers,
        "center": center,
    }
    assert "Text" not in contracts["components"]
    assert "additionalProperties: false" in instructions
    valid = 'root = LocationView(markers=[{label:"North Aral Sea",lat:46.5,lng:60.7,category:"Kazakhstan"}])'
    assert (
        compiler.compile(valid, final=True)[0]["createSurface"]["components"][0][
            "markers"
        ][0]["category"]
        == "Kazakhstan"
    )
    with pytest.raises(ValueError, match="markers"):
        compiler.compile(valid.replace("category:", "description:"), final=True)


def test_compiles_v1_children_bindings_function_and_event():
    operations = ExpressCompiler(envelope(), surface_id="result").compile(
        """
root = Column([title, price, button])
title = Text($/title)
price = Text(formatCurrency(42, "USD"))
button = Button(label="Go", onClick=Event("choose", {value: $/title}))
$/title = "Hello"
""",
        final=True,
    )
    assert len(operations) == 1
    assert operations[0]["version"] == "v1.0"
    created = operations[0]["createSurface"]
    assert created["surfaceId"] == "result"
    assert created["catalogId"] == "demo"
    components = {c["id"]: c for c in created["components"]}
    assert components["root"]["children"] == ["title", "price", "button"]
    assert components["title"]["text"] == {"@path": "/title"}
    assert components["price"]["text"] == {
        "@call": "formatCurrency",
        "args": {"value": 42, "currency": "USD"},
    }
    assert "onClick" in components["button"]
    assert created["dataModel"] == {"title": "Hello"}


def test_partial_prefix_retains_complete_statements_and_final_errors_raise():
    compiler = ExpressCompiler(envelope())
    source = 'root = Text("Hello")\nnext = Text("unfinished'
    assert (
        compiler.compile(source)[0]["createSurface"]["components"][0]["text"] == "Hello"
    )
    assert compiler.compile('root = Text("unfinished') == []
    with pytest.raises(ValueError):
        compiler.compile(source, final=True)


def test_unknown_component_and_missing_required_prop_rejected_on_final():
    compiler = ExpressCompiler(envelope())
    for source in ['root = Invented("hello")', "root = Text()"]:
        assert compiler.compile(source) == []
        with pytest.raises(ValueError):
            compiler.compile(source, final=True)


def test_delete_surface_and_explicit_surface_name():
    compiler = ExpressCompiler(envelope())
    assert compiler.compile('deleteSurface("old")', final=True) == [
        {"version": "v1.0", "deleteSurface": {"surfaceId": "old"}}
    ]
    assert (
        compiler.compile('surface("chosen")\nroot = Text("Hi")', final=True)[0][
            "createSurface"
        ]["surfaceId"]
        == "chosen"
    )


def test_single_slot_template_and_function_value_maps():
    catalog = envelope()
    catalog["v1.0"]["inlineCatalogs"][0]["components"]["Card"] = {
        "props": {"type": "object", "properties": {}},
        "slots": {"child": "single"},
    }
    catalog["v1.0"]["inlineCatalogs"][0]["functions"]["calc"] = {
        "parameters": {
            "type": "object",
            "description": "{ expression: string; [name: string]: number }",
        },
        "returnType": "any",
    }
    operations = ExpressCompiler(catalog).compile(
        """
root = Card(child=Column(_template($/items, item)))
item = Text({"@call": "calc", args: {expression: "x+1", x: $value}})
$/items = [{value: 1}]
""",
        final=True,
    )
    components = {c["id"]: c for c in operations[0]["createSurface"]["components"]}
    child_id = components["root"]["child"]
    assert components[child_id]["children"] == {"componentId": "item", "path": "/items"}
    assert components["item"]["text"]["args"]["x"] == {"@path": "value"}


def test_explicit_null_data_update_is_not_dropped():
    operations = ExpressCompiler(envelope()).compile(
        'surface("existing", update=true)\n$/nested/value = null', final=True
    )
    assert operations == [
        {
            "version": "v1.0",
            "updateDataModel": {
                "surfaceId": "existing",
                "path": "/nested/value",
                "value": None,
            },
        }
    ]


def test_nested_check_functions_from_standard_control_schema():
    catalog = envelope()
    # The relevant shape from standardUI TextField.props: dynamic values are
    # allowed recursively, including inside each check's condition.
    catalog["v1.0"]["inlineCatalogs"][0]["components"]["TextField"] = {
        "props": {
            "type": "object",
            "properties": {
                "value": {"type": "string"},
                "checks": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "condition": {"type": "boolean"},
                            "message": {"type": "string"},
                        },
                        "additionalProperties": False,
                    },
                },
            },
            "additionalProperties": False,
        }
    }
    catalog["v1.0"]["inlineCatalogs"][0]["functions"]["email"] = {
        "parameters": {"type": "object", "description": "{ value: string }"},
        "returnType": "boolean",
    }
    compiler = ExpressCompiler(catalog)
    operations = compiler.compile(
        'root = TextField(value=$/email, checks=[{condition:email($/email),message:"Invalid email"}])',
        final=True,
    )
    check = operations[0]["createSurface"]["components"][0]["checks"][0]
    assert check["condition"] == {
        "@call": "email",
        "args": {"value": {"@path": "/email"}},
    }


def test_invalid_literal_schema_errors_are_value_errors():
    with pytest.raises(ValueError, match="text"):
        ExpressCompiler(envelope()).compile("root = Text(text=42)", final=True)


def test_instructions_use_keyword_arguments_for_long_standard_signatures():
    instructions = ExpressCompiler(envelope()).instructions()
    assert "Do not output property keys" not in instructions
    assert 'Text(text={"@call"' in instructions


def test_partial_event_waits_for_a_nonempty_name():
    compiler = ExpressCompiler(envelope())
    prefix = 'root = Column(\nchildren=[\nButton(\nlabel="Go",\nonClick=Event("cho'
    assert compiler.compile(prefix) == []
    result = compiler.compile(prefix + 'ose"))])', final=True)
    button = next(
        node
        for node in result[0]["createSurface"]["components"]
        if node["component"] == "Button"
    )
    assert button["onClick"] == {"event": {"name": "choose"}}


def test_empty_event_name_is_rejected_on_final():
    with pytest.raises(ValueError):
        ExpressCompiler(envelope()).compile(
            'root = Button(label="Go", onClick=Event(""))', final=True
        )


@pytest.mark.parametrize(
    "source",
    [
        'root = Column(children=["missing"])',
        'root = Column(children=["root"])',
        'root = Column(children=["child"])\nchild = Column(children=["root"])',
        'root = Text("valid")\na = Column(children=["b"])\nb = Column(children=["a"])',
    ],
)
def test_whole_surface_graph_rejects_dangling_and_cyclic_children(source):
    compiler = ExpressCompiler(envelope())
    assert compiler.compile(source) == []
    with pytest.raises(ValueError):
        compiler.compile(source, final=True)


def test_forward_child_reference_waits_for_a_valid_complete_graph():
    compiler = ExpressCompiler(envelope())
    source = 'root = Column(children=["child"])\n'
    assert compiler.compile(source) == []
    result = compiler.compile(source + 'child = Text("Ready")', final=True)
    assert len(result[0]["createSurface"]["components"]) == 2


def action_catalog():
    value = envelope()
    value["v1.0"]["inlineCatalogs"][0]["functions"]["saveNote"] = {
        "parameters": {
            "type": "object",
            "properties": {"text": {"type": "string"}},
            "required": ["text"],
            "additionalProperties": False,
        },
        "returnType": "any",
        "allowedCallers": "rendererOnly",
    }
    return value


def test_explicit_action_maps_keep_user_message_context_and_client_functions():
    result = ExpressCompiler(action_catalog()).compile(
        """
root = Column([save, follow])
save = Button(label="Save", onClick={functionCall:saveNote(text=$/note)})
follow = Button(label="Explain", onClick={event:{name:"followUp",userMessage:"Explain this",context:{note:$/note}}})
$/note = "A finding"
""",
        final=True,
    )
    nodes = {node["id"]: node for node in result[0]["createSurface"]["components"]}
    assert nodes["save"]["onClick"] == {
        "functionCall": {"@call": "saveNote", "args": {"text": {"@path": "/note"}}}
    }
    assert nodes["follow"]["onClick"] == {
        "event": {
            "name": "followUp",
            "userMessage": "Explain this",
            "context": {"note": {"@path": "/note"}},
        }
    }


def test_action_guidance_documents_supported_syntax_and_no_server_execution():
    guide = ExpressCompiler(action_catalog()).instructions()
    assert "functionCall:" in guide
    assert "userMessage:" in guide
    assert "context:" in guide
    assert 'radius="md"' in guide


def test_parameter_order_preserves_native_component_calling_convention():
    catalog = envelope()
    catalog["v1.0"]["inlineCatalogs"][0]["components"]["Button"]["parameterOrder"] = [
        "onClick",
        "label",
    ]
    result = ExpressCompiler(catalog).compile(
        'root = Button(Event("go"), "Go")', final=True
    )
    node = result[0]["createSurface"]["components"][0]
    assert node["label"] == "Go"
    assert node["onClick"] == {"event": {"name": "go"}}
