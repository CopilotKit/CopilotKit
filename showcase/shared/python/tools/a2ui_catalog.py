"""Host catalog contract for secondary A2UI generators.

The frontend sends an inline catalog in the middleware's schema context entry.
Never infer a catalog from model-authored prose or fall back to an invented ID.
"""

import json

from ag_ui_a2ui_toolkit import split_a2ui_schema_context, validate_a2ui_components
from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError
from referencing.exceptions import Unresolvable
from referencing import Registry


def read_client_catalog(context_entries):
    value, _ = split_a2ui_schema_context(context_entries)
    catalog = json.loads(value) if isinstance(value, str) else value
    if (
        not isinstance(catalog, dict)
        or not isinstance(catalog.get("catalogId"), str)
        or not catalog["catalogId"]
    ):
        raise ValueError("The host did not supply an A2UI catalog ID.")
    components = catalog.get("components")
    if not isinstance(components, dict) or not components:
        raise ValueError("The host did not supply A2UI component definitions.")
    for schema in components.values():
        if not isinstance(schema, dict):
            raise ValueError("A host component schema must be an object.")
        try:
            Draft202012Validator.check_schema(_component_schema(schema))
        except SchemaError as exc:
            raise ValueError("The host supplied an invalid component schema.") from exc
    return catalog


def _component_schema(schema):
    # extractCatalogComponentSchemas wraps each component in ComponentCommon
    # plus the original Zod schema. Its local refs are relative to that original
    # schema, so validate it as a document, not nested under the allOf wrapper.
    if "allOf" in schema:
        parts = schema["allOf"]
        if (
            isinstance(parts, list)
            and len(parts) == 2
            and parts[0] == {"$ref": "common_types.json#/$defs/ComponentCommon"}
            and isinstance(parts[1], dict)
        ):
            # Renderer props are strict even though the extracted inline
            # wrapper omits additionalProperties. ComponentCommon supplies id.
            return {
                **parts[1],
                "properties": {
                    **parts[1].get("properties", {}),
                    "id": {"type": "string"},
                },
                "additionalProperties": False,
            }
    return schema


def validate_client_surface(args, catalog):
    if not isinstance(args, dict):
        raise ValueError("render_a2ui arguments must be an object.")
    if args.get("catalogId") != catalog["catalogId"]:
        raise ValueError("The generated catalogId does not match the host catalog.")
    if not isinstance(args.get("surfaceId"), str) or not args["surfaceId"]:
        raise ValueError("surfaceId must be a non-empty string.")
    data = args.get("data", {})
    if not isinstance(data, dict):
        raise ValueError("The surface data model must be an object.")
    schemas = {
        name: _component_schema(schema)
        for name, schema in catalog["components"].items()
    }
    result = validate_a2ui_components(
        components=args.get("components"), data=data, catalog={"components": schemas}
    )
    if not result["valid"]:
        raise ValueError("; ".join(error["message"] for error in result["errors"]))
    for component in args["components"]:
        try:
            # No network resolution of host-provided schema references.
            errors = list(
                Draft202012Validator(
                    schemas[component["component"]], registry=Registry()
                ).iter_errors(component)
            )
        except Unresolvable as exc:
            raise ValueError(
                "The host component schema contains an unresolved reference."
            ) from exc
        if errors:
            raise ValueError(f"Component {component['id']}: {errors[0].message}")
