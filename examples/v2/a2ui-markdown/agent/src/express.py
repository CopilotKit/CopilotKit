"""Demo adapter from the browser's catalog to the released A2UI Express SDK.

The SDK compiles complete snapshots, including partial programs. The transport
owns chunk buffering and the diff between successive snapshots.
"""

import re
from copy import deepcopy
from typing import Any

from a2ui.core import Catalog, PayloadValidator
from a2ui.inference_formats.express import ExpressFormat
from a2ui.skill import SkillGenerator


def _nested_values(schema: Any) -> Any:
    if not isinstance(schema, dict):
        return schema
    result = deepcopy(schema)
    if "properties" in result:
        result["properties"] = {
            name: _dynamic(value) for name, value in result["properties"].items()
        }
    if "items" in result:
        result["items"] = _dynamic(result["items"])
    if isinstance(result.get("additionalProperties"), dict):
        result["additionalProperties"] = _dynamic(result["additionalProperties"])
    for keyword in ("anyOf", "oneOf", "allOf"):
        if keyword in result:
            result[keyword] = [_nested_values(branch) for branch in result[keyword]]
    return result


def _dynamic(schema: Any) -> dict[str, Any]:
    """Native UI props can be literal values, data bindings or function values."""
    return {
        "anyOf": [
            _nested_values(schema),
            {"$ref": "#/$defs/DataBinding"},
            {"$ref": "#/$defs/FunctionCall"},
        ],
        **(
            {"description": schema["description"]}
            if isinstance(schema, dict) and "description" in schema
            else {}
        ),
    }


def _component(entry: dict[str, Any]) -> dict[str, Any]:
    # Normal adapter conversion, not an SDK defect: the browser describes
    # props, slots and events separately; the SDK consumes catalog JSON Schema.
    schema = deepcopy(entry["props"])
    schema["properties"] = {
        name: _dynamic(value) for name, value in schema.get("properties", {}).items()
    }
    for name, cardinality in entry.get("slots", {}).items():
        schema["properties"][name] = {
            "$ref": "#/$defs/ChildList"
            if cardinality == "multiple"
            else "#/$defs/Child"
        }
    for name, event in entry.get("events", {}).items():
        # FIX(demo-bridge): match CopilotKit's nonempty event-name requirement.
        # SDK 0.9.0 can fill an unfinished Event("sub with an empty name in a
        # multiline prefix. Reject that snapshot before recording a create
        # which the frontend would reject. This is host validation, not an SDK
        # patch; keep it even when upstream gains incremental parsing.
        schema["properties"][name] = {
            "allOf": [
                {"$ref": "#/$defs/Action"},
                {"properties": {"event": {"properties": {"name": {"minLength": 1}}}}},
            ]
        }
        if event.get("description"):
            schema["properties"][name]["description"] = event["description"]
    if entry.get("description"):
        schema["description"] = entry["description"]
    return schema


def _function(entry: dict[str, Any]) -> dict[str, Any]:
    result = deepcopy(entry)
    parameters = result.get("parameters", {})
    # Normal adapter conversion, not an SDK defect: our built-in functions
    # arrive as short TypeScript-style signatures instead of argument schemas.
    if "properties" not in parameters:
        fields = re.findall(
            r"(?:\{|;)\s*(\w+)(\?)?\s*:\s*([^;}]+)", parameters.get("description", "")
        )
        parameters["properties"] = {
            name: {"description": value.strip()} for name, _, value in fields
        }
        parameters["required"] = [name for name, optional, _ in fields if not optional]
    result.pop("parameters", None)
    result["type"] = "object"
    result["properties"] = {"args": parameters}
    return result


class ExpressCompiler:
    def __init__(self, envelope: dict[str, Any], surface_id: str = "main"):
        received = envelope.get("v1.0", {}).get("inlineCatalogs", [])
        if not received or not received[0].get("components"):
            raise ValueError("Express requires the browser's inline component catalog")
        self.catalogs = []
        for inline in received:
            document = {
                "catalogId": inline["catalogId"],
                "protocolVersion": "1.0",
                "components": {
                    name: _component(entry)
                    for name, entry in inline["components"].items()
                },
                "functions": {
                    name: _function(entry)
                    for name, entry in inline.get("functions", {}).items()
                },
            }
            self.catalogs.append(Catalog.from_json(document, protocol_version="v1.0"))
        self.format = ExpressFormat(
            self.catalogs, version="v1.0", surface_id=surface_id
        )
        self.parser = self.format.create_parser()
        self.validators = {
            catalog.id: PayloadValidator(catalog) for catalog in self.catalogs
        }

    def instructions(self) -> str:
        skill = SkillGenerator(self.format).generate_skill()
        # Host transport customization, not an SDK defect: this demo uses
        # fences/tool arguments instead of the SDK's default sentinel tags.
        grammar = "\n".join(
            line for line in skill.content.splitlines() if "sentinel tags" not in line
        )
        # WORKAROUND (agent-sdk 0.9.0/core 0.4.0): generated catalog prose
        # forbids property keys although Express accepts keyword arguments.
        # Our standard Text has color before text, so Text("Hello") sets color.
        # Repro: test_instructions_use_keyword_arguments_for_long_standard_signatures.
        # Remove when skill generation supports keyword-oriented guidance;
        # property order itself is valid catalog behavior, not a compiler bug.
        grammar = grammar.replace(
            "Use these exact positional signatures to instantiate components. Do not output property keys:",
            'Use keyword arguments matching these component signatures, for example Text(text="Hello"). '
            "Keyword arguments avoid counting optional styling parameters:",
        )
        # WORKAROUND (agent-sdk 0.9.0/core 0.4.0): calc(expression="x+1", x=2)
        # rejects x even when the args schema has additionalProperties=true.
        # Function-value maps preserve open-ended args; repro coverage:
        # test_single_slot_template_and_function_value_maps.
        # Remove this guidance when Express honors open-ended function args.
        return (
            grammar
            + """

Functions with additional named arguments (such as calc and series) must use
a function-value map instead of constructor syntax. For example:
Text(text={"@call": "calc", args: {expression: "seats * 29", seats: $/seats}})
Use only functions listed in this catalog. Function values use "@call";
data bindings compile to "@path", as required by A2UI v1.0.
"""
        )

    def compile(self, source: str, final: bool = False) -> list[dict[str, Any]]:
        # WORKAROUND (agent-sdk 0.9.0/core 0.4.0): ExpressParser.supports_streaming
        # is false and parse_chunk("root = Text(...)") raises NotImplementedError.
        # Recompile accumulated prefixes; the transport diffs the snapshots.
        # Repro coverage: test_partial_prefix_retains_complete_statements_and_final_errors_raise.
        # Replace with the SDK chunk API when it supports incremental Express.
        try:
            operations = [
                message.model_dump(mode="json", by_alias=True, exclude_unset=True)
                for message in self.parser.compile(source, is_final=final)
            ]
            for operation in operations:
                if operation.get("version") != "v1.0":
                    raise ValueError("Express emitted a non-v1.0 operation")
                payload = operation.get("createSurface") or operation.get(
                    "updateComponents"
                )
                if payload:
                    catalog_id = payload.get("catalogId", self.catalogs[0].id)
                    for component in payload.get("components", []):
                        self.validators[
                            component.get("catalogId", catalog_id)
                        ].validate_component(component)
            return operations
        except Exception as error:
            # Half a statement or a referenced child not yet written is
            # expected while streaming. Final errors are surfaced for repair.
            if final:
                raise ValueError(f"Invalid A2UI Express: {error}") from error
            return []
