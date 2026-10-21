import pytest

from src.express import ExpressCompiler


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
