"""Generative UI (A2UI 1.0): the render_ui tool, its guide, and validated surface events.

Ports `generative-ui-middleware.ts` of the TypeScript runtime and the shared helpers it
uses (`a2ui-envelope.ts`, `validate-operation.ts`, `render-ui-args.ts`, `prompt.ts`).
The browser sends its catalog in `forwardedProps.copilotkit.ui`; nothing in it is trusted.
"""

import json
import math
import re
from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass, field
from typing import Any, Literal, TypeGuard
from uuid import uuid4

from .a2ui import A2UIConfig
from .models import Json

A2UIVersion = Literal["0.9", "1.0"]

A2UI_VERSION = "1.0"
GENERATIVE_UI_ACTIVITY_TYPE = "generative-ui-surface"
GENERATIVE_UI_RENDER_TOOL = "render_ui"
GENERATIVE_UI_CHAT_TARGET = "chat"
GENERATIVE_UI_CONTEXT_DESCRIPTION = (
    "Generative UI guide: available components, functions, targets, and how to call render_ui."
)
STANDARD_CATALOG_ID = "copilotkit/standard@1"
COMPONENT_ID_REF = "common_types.json#/$defs/ComponentId"
CHILD_LIST_REF = "common_types.json#/$defs/ChildList"
# The agent may not call renderer functions yet (`GENERATIVE_UI_AGENT_FUNCTION_CALLS`).
AGENT_FUNCTION_CALLS_OFF_REASON = (
    "callRendererFunction is not supported in this version: the agent cannot call renderer "
    "functions until their results can be sent back to it reliably"
)
_ENVELOPE_FORMAT = 3
_MAX_TARGET_COMPONENTS = 100
_MAX_SUMMARY_REJECTIONS = 20
_MAX_REJECTION_LENGTH = 500
_MAX_USER_VALUES_LENGTH = 500
_UNSET: Any = object()


def compact_json(value: Any) -> str:
    """Serialize like `JSON.stringify`, so prompts and payloads match the TypeScript runtime."""
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def is_record(value: Any) -> TypeGuard[dict[str, Any]]:
    """True for a JSON object."""
    return isinstance(value, dict)


def _is_number(value: Any) -> bool:
    """True for a finite JSON number, never a boolean."""
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _nonempty_str(value: Any) -> TypeGuard[str]:
    return isinstance(value, str) and value != ""


def surface_message_id(surface_id: str) -> str:
    """The activity message id of a surface. One message per surface."""
    return f"genui:{surface_id}"


# ---------------------------------------------------------------------------
# Built-in functions (`basic-functions.ts`)


@dataclass(frozen=True)
class BasicFunction:
    """A function of the A2UI basic catalog (or a CopilotKit addition), callable by the UI."""

    description: str
    parameters: str
    return_type: str
    requires_user_activation: bool = False


A2UI_BASIC_FUNCTIONS: dict[str, BasicFunction] = {
    "required": BasicFunction(
        "Valid when the value is not empty", "{ value: unknown }", "validationResult"
    ),
    "regex": BasicFunction(
        "Valid when the value matches the pattern",
        "{ value: string; pattern: string }",
        "validationResult",
    ),
    "length": BasicFunction(
        "Valid when the length of the value is within min and max",
        "{ value: string; min?: number; max?: number }",
        "validationResult",
    ),
    "numeric": BasicFunction(
        "Valid when the value is a number within min and max",
        "{ value: number; min?: number; max?: number }",
        "validationResult",
    ),
    "email": BasicFunction(
        "Valid when the value is an email address", "{ value: string }", "validationResult"
    ),
    "formatString": BasicFunction(
        "Interpolates ${/path}, ${relative/path} and ${fn(arg: value)} in the value; "
        "\\${ is a literal",
        "{ value: string }",
        "string",
    ),
    "formatNumber": BasicFunction(
        "The number in the locale of the user",
        "{ value: number; decimals?: number; grouping?: boolean }",
        "string",
    ),
    "formatCurrency": BasicFunction(
        "The amount as money, with an ISO 4217 currency code",
        "{ value: number; currency: string; decimals?: number; grouping?: boolean }",
        "string",
    ),
    "formatDate": BasicFunction(
        'A date or ISO string in a TR35 pattern, for example "MMM d, yyyy" or "HH:mm"',
        "{ value: string | number; format: string }",
        "string",
    ),
    "pluralize": BasicFunction(
        "The string of the plural category of the value",
        "{ value: number; zero?: string; one?: string; two?: string; few?: string; "
        "many?: string; other: string }",
        "string",
    ),
    "openUrl": BasicFunction(
        "Opens an http(s) URL in a new tab. Only from an event",
        "{ url: string }",
        "void",
        requires_user_activation=True,
    ),
    "and": BasicFunction("True when every value is true", "{ values: boolean[] }", "boolean"),
    "or": BasicFunction("True when any value is true", "{ values: boolean[] }", "boolean"),
    "not": BasicFunction("The negated value", "{ value: boolean }", "boolean"),
}
_COPILOTKIT_FUNCTIONS: dict[str, BasicFunction] = {
    "calc": BasicFunction(
        "The value of an arithmetic expression over the other args, by name: + - * / % ( ), "
        "x ^ y (power), comparisons, && || !, cond ? a : b, min max round floor ceil abs pow "
        "sqrt exp ln log10, the constants pi and e, 'text' + name",
        "{ expression: string; [name: string]: number | string | boolean }",
        "any",
    ),
    "series": BasicFunction(
        "A list of count copies of item, for chart data and template lists. Put arithmetic in "
        "${expression} strings in item, using the loop variable (default i, counting from "
        "start, default 1) and other named args. A whole-expression string retains the result "
        'type, so "${i * monthlyCost}" yields a number. Arguments, including nested calc or '
        "formatString calls in item, resolve before the series loop; those calls cannot use "
        'the loop variable. Example: {"@call":"series","args":{"count":6,"item":{"month":'
        '"${i}","cost":"${i * monthlyCost}"},"monthlyCost":{"@path":"/monthlyCost"}}}. Omit '
        "variable to use i.",
        "{ count: number; item: unknown; variable?: string; start?: number; "
        "[name: string]: unknown }",
        "array",
    ),
}
GENERATIVE_UI_FUNCTIONS: dict[str, BasicFunction] = {
    **A2UI_BASIC_FUNCTIONS,
    **_COPILOTKIT_FUNCTIONS,
}
_INDEX_FUNCTION = "@index"


def is_basic_function(name: str) -> bool:
    """True for a built-in function name: basic, CopilotKit, or `@index`."""
    return name == _INDEX_FUNCTION or name in GENERATIVE_UI_FUNCTIONS


def _is_value_function(name: str) -> bool:
    """True for a built-in function that a prop or a check may call."""
    if name == _INDEX_FUNCTION:
        return True
    info = GENERATIVE_UI_FUNCTIONS.get(name)
    return info is not None and not info.requires_user_activation


def function_callers(fn: Json | BasicFunction) -> tuple[bool, bool]:
    """Who may call a function, as (renderer, agent). An undeclared caller is the renderer."""
    if isinstance(fn, BasicFunction):
        return True, False
    if fn.get("requiresUserActivation"):
        return True, False
    callers = fn.get("allowedCallers") or "rendererOnly"
    return callers != "agentOnly", callers != "rendererOnly"


_VALUE_FUNCTION_LIST = (
    "@index and the built-in functions ("
    + ", ".join(name for name in GENERATIVE_UI_FUNCTIONS if _is_value_function(name))
    + ")"
)


# ---------------------------------------------------------------------------
# Envelope (`a2ui-envelope.ts`)


def _optional_str(record: Json, key: str) -> bool:
    value = record.get(key, _UNSET)
    return value is _UNSET or isinstance(value, str)


def _record_of(value: Any, check: Any) -> bool:
    return is_record(value) and all(check(entry) for entry in value.values())


def _is_schema_entry(value: Any) -> bool:
    return (
        is_record(value)
        and is_record(value.get("parameters"))
        and _optional_str(value, "description")
    )


def _is_props_schema(value: Any) -> bool:
    if not is_record(value):
        return False
    properties = value.get("properties", _UNSET)
    required = value.get("required", _UNSET)
    return (properties is _UNSET or is_record(properties)) and (
        required is _UNSET
        or (isinstance(required, list) and all(isinstance(name, str) for name in required))
    )


def _is_component_manifest(value: Any) -> bool:
    if (
        not is_record(value)
        or not _is_props_schema(value.get("props"))
        or not _optional_str(value, "description")
        or ("events" in value and not _record_of(value["events"], _is_schema_entry))
        or (
            "slots" in value
            and not _record_of(value["slots"], lambda kind: kind in ("single", "multiple"))
        )
    ):
        return False
    order = value.get("parameterOrder", _UNSET)
    if order is _UNSET:
        return True
    keys = {
        *value["props"].get("properties", {}),
        *value.get("slots", {}),
        *value.get("events", {}),
    }
    return (
        isinstance(order, list)
        and all(isinstance(key, str) and key in keys for key in order)
        and len(set(order)) == len(order)
    )


def _is_inline_catalog(value: Any) -> bool:
    return (
        is_record(value)
        and _nonempty_str(value.get("catalogId"))
        and value.get("protocolVersion") == "1.0"
        and ("components" not in value or _record_of(value["components"], _is_component_manifest))
        and _record_of(value.get("functions"), _is_schema_entry)
        and _optional_str(value, "instructions")
    )


def _is_capabilities(value: Any) -> bool:
    if not is_record(value):
        return False
    ids = value.get("supportedCatalogIds")
    catalogs = value.get("inlineCatalogs", _UNSET)
    return (
        isinstance(ids, list)
        and len(ids) > 0
        and all(_nonempty_str(entry) for entry in ids)
        and (
            catalogs is _UNSET
            or (isinstance(catalogs, list) and all(_is_inline_catalog(entry) for entry in catalogs))
        )
    )


def _is_target(value: Any) -> bool:
    if not is_record(value):
        return False
    components = value.get("components", _UNSET)
    return (
        _nonempty_str(value.get("id"))
        and value.get("kind") in ("chat", "inline")
        and _optional_str(value, "description")
        and (
            components is _UNSET
            or (
                isinstance(components, list)
                and len(components) <= _MAX_TARGET_COMPONENTS
                and all(_nonempty_str(name) for name in components)
            )
        )
    )


def _is_surface_entry(value: Any) -> bool:
    if not is_record(value):
        return False
    rejected = value.get("rejected", _UNSET)
    return (
        _nonempty_str(value.get("target"))
        and ("dataModel" not in value or is_record(value["dataModel"]))
        and (
            rejected is _UNSET
            or (
                isinstance(rejected, list)
                and len(rejected) <= _MAX_SUMMARY_REJECTIONS
                and all(
                    isinstance(entry, str) and len(entry) <= _MAX_REJECTION_LENGTH
                    for entry in rejected
                )
            )
        )
        and value.get("status", _UNSET) in (_UNSET, "deleted", "failed")
    )


def _is_extensions(value: Any) -> bool:
    if not is_record(value):
        return False
    format_ = value.get("copilotkit_format")
    targets = value.get("copilotkit_targets")
    return (
        _is_number(format_)
        and format_ == _ENVELOPE_FORMAT
        and value.get("copilotkit_transport") in ("tool", "markdown")
        and isinstance(targets, list)
        and all(_is_target(target) for target in targets)
        and _record_of(value.get("copilotkit_surfaces"), _is_surface_entry)
        and isinstance(value.get("copilotkit_contextSent"), bool)
    )


def read_envelope(forwarded_props: Any) -> Json | None:
    """Read the generative UI envelope from `forwardedProps`, or None when it is malformed."""
    if not is_record(forwarded_props):
        return None
    namespace = forwarded_props.get("copilotkit")
    if not is_record(namespace):
        return None
    envelope = namespace.get("ui")
    if (
        is_record(envelope)
        and _is_capabilities(envelope.get("1.0"))
        and is_record(envelope.get("metadata"))
        and _is_extensions(envelope["metadata"].get("extensions"))
    ):
        return envelope
    return None


@dataclass(frozen=True)
class GenerativeUIManifest:
    """What the client renders: its catalog, functions, targets and surfaces."""

    catalog_id: str
    catalog_ids: list[str]
    components: dict[str, Json]
    functions: dict[str, Json]
    targets: list[Json]
    surfaces: dict[str, Json]
    transport: str
    has_components: bool
    action: Json | None = None


def envelope_to_manifest(envelope: Json) -> GenerativeUIManifest:
    """Turn an envelope from `read_envelope` into the manifest of the run."""
    capabilities = envelope["1.0"]
    catalog_ids = capabilities["supportedCatalogIds"]
    catalog = next(
        (
            entry
            for entry in capabilities.get("inlineCatalogs", [])
            if entry["catalogId"] == catalog_ids[0]
        ),
        None,
    )
    extensions = envelope["metadata"]["extensions"]
    action = extensions.get("copilotkit_action")
    return GenerativeUIManifest(
        catalog_id=catalog_ids[0],
        catalog_ids=catalog_ids,
        components=catalog.get("components", {}) if catalog else {},
        functions=catalog["functions"] if catalog else {},
        targets=extensions["copilotkit_targets"],
        surfaces=extensions["copilotkit_surfaces"],
        transport=extensions["copilotkit_transport"],
        has_components=catalog is not None and "components" in catalog,
        action=action if is_record(action) else None,
    )


def read_tool_manifest(forwarded_props: Any) -> GenerativeUIManifest | None:
    """The manifest of a "tool" run whose catalog has components; otherwise the run passes."""
    envelope = read_envelope(forwarded_props)
    if envelope is None:
        return None
    manifest = envelope_to_manifest(envelope)
    return manifest if manifest.transport == "tool" and manifest.has_components else None


# ---------------------------------------------------------------------------
# Runtime option (`GenerativeUIOptions` of `core/runtime.ts`)


@dataclass(frozen=True)
class GenerativeUIConfig:
    """Turn on generative UI for every run of `agents` (all agents when None).

    `a2ui_version` is "1.0" (default; the agent gets `render_ui` and the generative UI
    guide), "0.9" (the agent gets `render_a2ui` and a v0.9 schema of the client's catalog),
    or a mapping of agent id to version; an agent missing from the mapping speaks "1.0".
    The remaining fields configure the A2UI v0.9 middleware of 0.9 agents only.
    `inject_a2ui_tool=None` adds `render_a2ui` when the client sends a "tool" catalog.
    """

    agents: tuple[str, ...] | None = None
    a2ui_version: A2UIVersion | Mapping[str, A2UIVersion] = "1.0"
    schema: Json | list[Json] | None = None
    inject_a2ui_tool: bool | str | None = None
    a2ui_tool_names: tuple[str, ...] = ("render_a2ui",)
    default_catalog_id: str | None = None
    max_attempts: int = 3
    show_progress_tokens: bool = True
    debug_exposure: str | None = None
    max_argument_bytes: int = field(default=2 * 1024 * 1024, repr=False)

    def __post_init__(self) -> None:
        """Validate public configuration before a run starts."""
        versions = (
            list(self.a2ui_version.values())
            if isinstance(self.a2ui_version, Mapping)
            else [self.a2ui_version]
        )
        if any(version not in ("0.9", "1.0") for version in versions):
            raise ValueError('a2ui_version must be "0.9", "1.0", or a mapping of agent ids to them')
        inject = self.inject_a2ui_tool
        self.a2ui_config(inject_tool=False if inject is None else inject)

    def a2ui_config(self, *, inject_tool: bool | str) -> A2UIConfig:
        """The A2UI v0.9 middleware configuration of a 0.9 agent."""
        return A2UIConfig(
            schema=self.schema,
            inject_tool=inject_tool,
            tool_names=self.a2ui_tool_names,
            default_catalog_id=self.default_catalog_id,
            max_attempts=self.max_attempts,
            show_progress_tokens=self.show_progress_tokens,
            debug_exposure=self.debug_exposure,
            max_argument_bytes=self.max_argument_bytes,
        )


GenerativeUIOption = bool | GenerativeUIConfig | None


def resolve_a2ui_version(option: GenerativeUIOption, agent_id: str) -> A2UIVersion:
    """The A2UI version of one agent; "1.0" unless the option says "0.9"."""
    if not isinstance(option, GenerativeUIConfig):
        return "1.0"
    version = (
        option.a2ui_version.get(agent_id)
        if isinstance(option.a2ui_version, Mapping)
        else option.a2ui_version
    )
    return "0.9" if version == "0.9" else "1.0"


def is_generative_ui_run(option: GenerativeUIOption, agent_id: str, forwarded_props: Any) -> bool:
    """Whether a run gets generative UI, as `configureAgentForRequest` decides.

    On for a run with a "tool" envelope, and for every run when the option turns it on.
    A "markdown" envelope gets no render tool. `False` and the `agents` filter always win.
    """
    if option is False:
        return False
    envelope = read_envelope(forwarded_props)
    transport = envelope["metadata"]["extensions"]["copilotkit_transport"] if envelope else None
    if transport != "tool" and (transport == "markdown" or not option):
        return False
    return not (
        isinstance(option, GenerativeUIConfig)
        and option.agents is not None
        and agent_id not in option.agents
    )


def a2ui_middleware_config(
    option: GenerativeUIOption, version: A2UIVersion, forwarded_props: Any
) -> A2UIConfig:
    """The v0.9 middleware of a run: full options for a 0.9 agent, extraction only for 1.0."""
    if version != "0.9":
        return A2UIConfig()
    envelope = read_envelope(forwarded_props)
    is_tool = envelope is not None and (
        envelope["metadata"]["extensions"]["copilotkit_transport"] == "tool"
    )
    config = option if isinstance(option, GenerativeUIConfig) else GenerativeUIConfig()
    inject = config.inject_a2ui_tool
    return config.a2ui_config(inject_tool=is_tool if inject is None else inject)


def generative_ui_info(option: GenerativeUIOption) -> Json:
    """The `generativeUI` field of `/info`."""
    if option is False:
        return {"enabled": False}
    if isinstance(option, GenerativeUIConfig) and option.agents is not None:
        return {"enabled": True, "agents": list(option.agents)}
    return {"enabled": True}


# ---------------------------------------------------------------------------
# Component references (`child-refs.ts`)

ChildRef = tuple[tuple[str, ...], str]


def child_ref_kind(schema: Json) -> str | None:
    """ "single" or "multiple" for a component reference schema, else None."""
    ref = schema.get("$ref")
    if ref == COMPONENT_ID_REF:
        return "single"
    if ref == CHILD_LIST_REF:
        return "multiple"
    return None


def collect_child_refs(schema: Any) -> list[ChildRef]:
    """Every component reference in a props schema, with its path ("*" for array items)."""
    refs: list[ChildRef] = []
    seen: set[tuple[str, ...]] = set()

    def add(path: tuple[str, ...], kind: str) -> None:
        if path in seen:
            return
        seen.add(path)
        refs.append((path, kind))

    def visit(node: Any, path: tuple[str, ...]) -> None:
        if not is_record(node):
            return
        kind = child_ref_kind(node)
        if kind:
            add(path, kind)
            return
        for variants in (node.get("anyOf"), node.get("oneOf")):
            if not isinstance(variants, list) or not variants:
                continue
            kinds = [child_ref_kind(v) if is_record(v) else None for v in variants]
            if kinds[0] and all(k == kinds[0] for k in kinds):
                add(path, kinds[0])
            elif all(k is None for k in kinds):
                # A nested reference counts only when every alternative has it.
                per_variant = [collect_child_refs(variant) for variant in variants]
                for ref_path, ref_kind in per_variant[0]:
                    if all((ref_path, ref_kind) in refs_ for refs_ in per_variant):
                        add(path + ref_path, ref_kind)
        if isinstance(node.get("allOf"), list):
            for variant in node["allOf"]:
                visit(variant, path)
        if is_record(node.get("properties")):
            for key, value in node["properties"].items():
                visit(value, (*path, key))
        if is_record(node.get("items")):
            visit(node["items"], (*path, "*"))

    visit(schema, ())
    return refs


# ---------------------------------------------------------------------------
# Operation validation (`validate-operation.ts`)

_OPERATION_KINDS = (
    "createSurface",
    "updateComponents",
    "updateDataModel",
    "deleteSurface",
    "callRendererFunction",
)
_V09_PATH_REASON = 'bind data with {"@path": "/x"}, not {"path": "/x"}'
_FORBIDDEN_SEGMENTS = {"__proto__", "constructor", "prototype"}
_ACCESSIBILITY_KEYS = ("label", "description", "live", "hidden")
_LIVE_VALUES = ("off", "polite", "assertive")


def operation_kind(op: Any) -> str | None:
    """The one operation key of `op`, when it has exactly one."""
    if not is_record(op):
        return None
    kinds = [kind for kind in _OPERATION_KINDS if kind in op]
    return kinds[0] if len(kinds) == 1 else None


def operation_surface_id(op: Any) -> str | None:
    """The `surfaceId` of a surface operation."""
    kind = operation_kind(op)
    if kind is None:
        return None
    payload = op[kind]
    return (
        payload["surfaceId"]
        if is_record(payload) and isinstance(payload.get("surfaceId"), str)
        else None
    )


def _is_path_binding(value: Any) -> bool:
    return is_record(value) and isinstance(value.get("@path"), str) and len(value) == 1


def _is_v09_path_binding(value: Any) -> bool:
    return is_record(value) and isinstance(value.get("path"), str) and len(value) == 1


def _is_call_binding(value: Any) -> bool:
    return is_record(value) and isinstance(value.get("@call"), str)


def _is_index_call(value: Any) -> bool:
    if not is_record(value) or value.get("@call") != _INDEX_FUNCTION:
        return False
    if any(key not in ("@call", "args") for key in value):
        return False
    if "args" not in value:
        return True
    args = value["args"]
    return (
        is_record(args)
        and all(key == "offset" for key in args)
        and ("offset" not in args or _is_number(args["offset"]))
    )


def _js_string(value: Any) -> str:
    """`String(value)` for the rejection reasons."""
    if isinstance(value, str):
        return value
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return "null"
    if is_record(value):
        return "[object Object]"
    if isinstance(value, list):
        return ",".join("" if item is None else _js_string(item) for item in value)
    return str(value)


@dataclass(frozen=True)
class AllowedComponents:
    """The component names that one target takes."""

    target: str
    names: tuple[str, ...]


@dataclass
class _Validation:
    manifest: GenerativeUIManifest
    known_surfaces: set[str]
    created_surfaces: set[str]
    functions: dict[str, Json] | None
    allowed: AllowedComponents | None


def validate_operation(
    op: Any,
    manifest: GenerativeUIManifest,
    known_surfaces: set[str],
    created_surfaces: set[str] | None = None,
    functions: dict[str, Json] | None = None,
    allowed: AllowedComponents | None = None,
) -> str | None:
    """Check one A2UI 1.0 operation from the model. Returns the rejection reason, or None."""
    options = _Validation(manifest, known_surfaces, created_surfaces or set(), functions, allowed)
    if not is_record(op):
        return "operation must be a JSON object"
    if op.get("version", _UNSET) != A2UI_VERSION:
        version = op.get("version")
        return (
            f'unsupported version "{version}"; use "{A2UI_VERSION}"'
            if isinstance(version, str)
            else f'operation needs "version":"{A2UI_VERSION}"'
        )
    kind = operation_kind(op)
    if kind is None:
        return f"operation must contain exactly one of {', '.join(_OPERATION_KINDS)}"
    if kind == "callRendererFunction":
        return AGENT_FUNCTION_CALLS_OFF_REASON
    payload = op[kind]
    if not is_record(payload) or not _nonempty_str(payload.get("surfaceId")):
        return f"{kind}.surfaceId is required"
    surface_id = payload["surfaceId"]
    if kind == "createSurface":
        return _create_surface_problem(payload, surface_id, options)
    if surface_id not in known_surfaces:
        return f'surface "{surface_id}" does not exist; send createSurface first'
    if kind == "updateDataModel":
        return _data_model_problem(payload)
    if kind == "updateComponents":
        return _components_problem(
            payload.get("components"), "updateComponents.components", options
        )
    return None


def _catalog_problem(catalog_id: Any, manifest: GenerativeUIManifest) -> str | None:
    """A `catalogId` can name the catalog of the run or one of its bases."""
    ids = manifest.catalog_ids or [manifest.catalog_id]
    if catalog_id is _UNSET or catalog_id in ids:
        return None
    names = ", ".join(f'"{entry}"' for entry in ids)
    use = names if len(ids) == 1 else f"one of: {names}"
    return f'unknown catalog "{_js_string(catalog_id)}"; leave out catalogId or use {use}'


def _create_surface_problem(payload: Json, surface_id: str, options: _Validation) -> str | None:
    if surface_id in options.known_surfaces:
        return f'surface "{surface_id}" already exists'
    if surface_id in options.created_surfaces:
        return f'surface id "{surface_id}" was used before; use a new surfaceId'
    reason = _catalog_problem(payload.get("catalogId", _UNSET), options.manifest)
    if reason:
        return reason
    if "dataModel" in payload and not is_record(payload["dataModel"]):
        return "createSurface.dataModel must be a JSON object"
    if "components" not in payload:
        return None
    return _components_problem(payload["components"], "createSurface.components", options)


def _data_model_problem(payload: Json) -> str | None:
    if "value" not in payload:
        return 'updateDataModel.value is required; use "value":null to delete'
    path = payload.get("path")
    if path is None:
        path = "/"
    if not isinstance(path, str) or not path.startswith("/"):
        return "updateDataModel.path must be an absolute JSON pointer"
    if path == "/":
        if not is_record(payload["value"]):
            return "a root updateDataModel value must be a JSON object"
        return None
    return _path_problem(path, "updateDataModel.path")


def _path_problem(path: str, label: str) -> str | None:
    """Check the segments of an absolute pointer or of a template-relative path."""
    segments = (path[1:] if path.startswith("/") else path).split("/")
    if any(segment == "" for segment in segments):
        return f"{label} must not contain empty segments"
    for segment in segments:
        decoded = re.sub(r"~([01])", lambda m: "/" if m.group(1) == "1" else "~", segment)
        if decoded in _FORBIDDEN_SEGMENTS:
            return f'path segment "{decoded}" is not allowed in {label}'
    return None


def _components_problem(components: Any, label: str, options: _Validation) -> str | None:
    if not isinstance(components, list) or not components:
        return f"{label} must be a non-empty array"
    ids: set[str] = set()
    for node in components:
        if not is_record(node):
            return "component must be a JSON object"
        identifier = node.get("id")
        if not _nonempty_str(identifier):
            return "id is required"
        reason = _node_problem(node, identifier, options)
        if reason:
            return f'component "{identifier}": {reason}'
        if identifier in ids:
            return f'component "{identifier}" appears twice in one update'
        ids.add(identifier)
    return None


def _node_problem(node: Json, identifier: str, options: _Validation) -> str | None:
    name = node.get("component")
    if not isinstance(name, str):
        return "component type is required"
    entry = options.manifest.components.get(name)
    if entry is None:
        return f'unknown component "{name}"'
    allowed = options.allowed
    if allowed and name not in allowed.names:
        names = ", ".join(allowed.names) or "none"
        return f'"{name}" is not allowed in target "{allowed.target}"; use one of: {names}'
    props = entry["props"]
    properties = props.get("properties")
    prop_names = list(properties) if is_record(properties) else []
    events = entry.get("events") or {}
    slots = entry.get("slots") or {}
    for key, value in node.items():
        if key in ("id", "component"):
            continue
        if key == "catalogId":
            reason = _catalog_problem(value, options.manifest)
            if reason:
                return f"{key}: {reason}"
            continue
        if key == "metadata":
            if not (
                is_record(value) and ("extensions" not in value or is_record(value["extensions"]))
            ):
                return 'metadata must be { "extensions": { ... } }'
            continue
        if key == "accessibility":
            reason = _accessibility_problem(value)
            if reason:
                return f"{key}: {reason}"
            continue
        if key in events:
            reason = _action_binding_problem(value, options)
            if reason:
                return f"{key}: {reason}"
            continue
        slot = slots.get(key)
        if slot is not None:
            reason = _slot_problem(value, slot, identifier)
            if reason:
                return f"{key}: {reason}"
            continue
        if key not in prop_names:
            return f'unknown prop "{key}"'
        if _is_v09_path_binding(value):
            return f"{key}: {_V09_PATH_REASON}"
        call = _forbidden_call(value)
        if call is not None:
            return f"{key}: {call}; a data prop can call only {_VALUE_FUNCTION_LIST}"
    for ref in collect_child_refs(props):
        reason = _child_ref_problem(node, ref, identifier)
        if reason:
            return reason
    required = props.get("required")
    for prop in required if isinstance(required, list) else []:
        if isinstance(prop, str) and prop not in node:
            return f'missing required prop "{prop}"'
    return None


def _accessibility_problem(value: Any) -> str | None:
    if not is_record(value):
        return 'must be { "label": "...", "description": "...", "live": "polite", "hidden": false }'
    for key, entry in value.items():
        if key not in _ACCESSIBILITY_KEYS:
            return f'unknown key "{key}"'
        if _is_v09_path_binding(entry):
            return f"{key}: {_V09_PATH_REASON}"
        if _is_path_binding(entry) or _is_call_binding(entry):
            call = _forbidden_call(entry)
            if call is not None:
                return f"{key}: {call}"
            continue
        if key == "live":
            if not isinstance(entry, str) or entry not in _LIVE_VALUES:
                return f"live must be one of {', '.join(_LIVE_VALUES)}"
        elif key == "hidden":
            if not isinstance(entry, bool):
                return "hidden must be a boolean"
        elif not isinstance(entry, str):
            return f"{key} must be a string"
    return None


def _action_binding_problem(value: Any, options: _Validation) -> str | None:
    if not is_record(value):
        return "must be an action object"
    keys = list(value)
    if len(keys) != 1 or keys[0] not in ("functionCall", "event"):
        return 'must be { "event": ... } or { "functionCall": ... }'
    if keys[0] == "functionCall":
        return _function_call_problem(value["functionCall"], "functionCall", options)
    return _event_problem(value["event"])


def _function_call_problem(call: Any, label: str, options: _Validation) -> str | None:
    if not is_record(call):
        return f'{label} must be {{ "@call": "<function>", "args": {{ ... }} }}'
    name = call.get("@call")
    if not _nonempty_str(name):
        return (
            f'{label} names the function with "@call", not "call"'
            if isinstance(call.get("call"), str)
            else f'{label}["@call"] must be a function name'
        )
    if "args" in call and not is_record(call["args"]):
        return f"{label}.args must be an object"
    reason = _catalog_problem(call.get("catalogId", _UNSET), options.manifest)
    if reason:
        return f"{label}: {reason}"
    for key, arg in (call.get("args") or {}).items():
        if _is_v09_path_binding(arg):
            return f"{label}.args.{key}: {_V09_PATH_REASON}"
    # A function the app declares under a built-in name is the app's own.
    app_functions = options.functions
    declared = app_functions.get(name) if app_functions is not None else None
    built_in = GENERATIVE_UI_FUNCTIONS.get(name) if declared is None else None
    if declared is None and built_in is None:
        return (
            None if app_functions is None else f'function "{name}" is not exposed to generative UI'
        )
    if declared is None and app_functions is None:
        return None
    fn: Json | BasicFunction | None = declared if declared is not None else built_in
    assert fn is not None
    renderer, agent = function_callers(fn)
    if label.startswith("callRendererFunction") and not agent:
        user_activation = (
            fn.requires_user_activation
            if isinstance(fn, BasicFunction)
            else fn.get("requiresUserActivation")
        )
        return (
            f'function "{name}" runs only from a user gesture; the agent cannot call it'
            if user_activation
            else f'function "{name}" runs only in the UI (allowedCallers "rendererOnly"); '
            "the agent cannot call it"
        )
    if not label.startswith("callRendererFunction") and not renderer:
        return (
            f'function "{name}" runs only for the agent (allowedCallers "agentOnly"); '
            "the UI cannot call it"
        )
    return None


def _event_problem(event: Any) -> str | None:
    if not is_record(event) or not _nonempty_str(event.get("name")):
        return "event.name is required"
    message = event.get("userMessage", _UNSET)
    is_message = (
        message is _UNSET
        or isinstance(message, str)
        or _is_path_binding(message)
        or (
            is_record(message)
            and isinstance(message.get("@call"), str)
            and _forbidden_call(message) is None
        )
    )
    if not is_message:
        return (
            f"event.userMessage: {_V09_PATH_REASON}"
            if _is_v09_path_binding(message)
            else 'event.userMessage must be a string, {"@path": "/x"} or a function value'
        )
    if "context" not in event:
        return None
    context = event["context"]
    if not is_record(context):
        return "event.context must be an object"
    for key, entry in context.items():
        if _is_v09_path_binding(entry):
            return f"event.context.{key}: {_V09_PATH_REASON}"
        call = _forbidden_call(entry)
        if call is not None:
            return (
                f"event.context.{key}: {call}; a context value can call only {_VALUE_FUNCTION_LIST}"
            )
    return None


def _slot_problem(value: Any, kind: str, own_id: str) -> str | None:
    is_template = is_record(value) and "componentId" in value
    if kind == "single" and is_template:
        return 'a template { "componentId", "path" } is only allowed in a "multiple" slot'
    if kind == "multiple" and is_template:
        return _template_problem(value, own_id)
    if kind == "multiple" and not isinstance(value, list):
        return 'must be an array of component ids or a template { "componentId", "path" }'
    for identifier in value if kind == "multiple" else [value]:
        if not _nonempty_str(identifier):
            return "must reference component ids (strings)"
        if identifier == own_id:
            return "a component cannot be its own child"
    return None


def _template_problem(template: Json, own_id: str) -> str | None:
    if any(key not in ("componentId", "path") for key in template):
        return 'a template takes only "componentId" and "path"'
    component_id, path = template.get("componentId"), template.get("path")
    if not _nonempty_str(component_id):
        return "template componentId must be a component id"
    if component_id == own_id:
        return "a component cannot be its own child"
    if not _nonempty_str(path):
        return "template path must be a JSON pointer or a relative path"
    return _path_problem(path, "template path")


def _forbidden_call(value: Any) -> str | None:
    """The first function call in a data value that is not a value function, at any depth."""
    if isinstance(value, list):
        for item in value:
            reason = _forbidden_call(item)
            if reason is not None:
                return reason
        return None
    if not is_record(value):
        return None
    if _is_index_call(value):
        return None
    if value.get("@call") == _INDEX_FUNCTION:
        return "@index takes only an offset"
    if isinstance(value.get("call"), str):
        return 'name the function with "@call", not "call"'
    if "functionCall" in value:
        return "an event binding is not a value"
    name = value.get("@call")
    if isinstance(name, str):
        if not _is_value_function(name):
            return (
                f'"{name}" runs only from an event'
                if is_basic_function(name)
                else f'"{name}" is not a basic function'
            )
        if "args" not in value:
            return None
        if not is_record(value["args"]):
            return f'the args of "{name}" must be an object'
        return _forbidden_call(value["args"])
    for item in value.values():
        reason = _forbidden_call(item)
        if reason is not None:
            return reason
    return None


def _child_ref_problem(node: Json, ref: ChildRef, own_id: str) -> str | None:
    """Check the component ids at one typed reference of a node, at any depth."""
    path, kind = ref
    label = ".".join(step for step in path if step != "*")

    def visit(value: Any, steps: tuple[str, ...]) -> str | None:
        # A bound or computed value is known only at render.
        if _is_path_binding(value) or (is_record(value) and "@call" in value):
            return None
        if not steps:
            reason = _slot_problem(value, kind, own_id)
            return f"{label}: {reason}" if reason else None
        head, rest = steps[0], steps[1:]
        if head == "*":
            if not isinstance(value, list):
                return None
            for item in value:
                reason = visit(item, rest)
                if reason:
                    return reason
            return None
        if not is_record(value) or head not in value:
            return None
        return visit(value[head], rest)

    return visit(node, path)


# ---------------------------------------------------------------------------
# Streamed render_ui arguments (`render-ui-args.ts`)


def _reject_constant(value: str) -> Any:
    raise ValueError(f"invalid JSON constant {value}")


def _parse_object(raw: str) -> Json | None:
    try:
        value = json.loads(raw, parse_constant=_reject_constant)
    except ValueError:
        return None
    return value if is_record(value) else None


class RenderUIArgsStream:
    """Read `target` and every complete `operations[]` element from streamed arguments.

    Each push scans only the new text. An element that is balanced but not a JSON object
    is reported as None.
    """

    def __init__(self) -> None:
        self.text = ""
        self.target: str | None = None
        self.operations: list[Json | None] = []
        self._emitted = 0
        self._stack: list[str] = []
        self._in_string = False
        self._escaped = False
        self._string_start = -1
        self._pending_key: str | None = None
        self._current_key: Any = None
        self._expecting_value = False
        self._in_operations = False
        self._element_start = -1

    @property
    def has_incomplete_operation(self) -> bool:
        """True when the text so far ends inside an `operations[]` element."""
        return self._element_start >= 0

    def push(self, delta: str) -> tuple[str | None, list[Json | None]]:
        """Add a delta; returns the target so far and the operations not reported before."""
        start = len(self.text)
        self.text += delta
        text, stack = self.text, self._stack
        for index in range(start, len(text)):
            char = text[index]
            if self._in_string:
                if self._escaped:
                    self._escaped = False
                elif char == "\\":
                    self._escaped = True
                elif char == '"':
                    self._in_string = False
                    if len(stack) == 1:
                        literal = text[self._string_start : index + 1]
                        if self._expecting_value:
                            if self._current_key == "target":
                                try:
                                    self.target = json.loads(literal)
                                except ValueError:
                                    pass
                            self._expecting_value = False
                        else:
                            self._pending_key = literal
                continue
            if char == '"':
                self._in_string = True
                self._string_start = index
            elif char == ":":
                if len(stack) == 1 and self._pending_key is not None:
                    try:
                        self._current_key = json.loads(self._pending_key)
                    except ValueError:
                        self._current_key = None
                    self._pending_key = None
                    self._expecting_value = True
            elif char == ",":
                if len(stack) == 1:
                    self._expecting_value = False
                    self._current_key = None
            elif char == "{":
                if self._in_operations and len(stack) == 2:
                    self._element_start = index
                stack.append("{")
            elif char == "[":
                if len(stack) == 1 and self._expecting_value and self._current_key == "operations":
                    self._in_operations = True
                stack.append("[")
            elif char in "}]":
                if stack:
                    stack.pop()
                if (
                    char == "}"
                    and self._in_operations
                    and len(stack) == 2
                    and self._element_start >= 0
                ):
                    self.operations.append(_parse_object(text[self._element_start : index + 1]))
                    self._element_start = -1
                if char == "]" and self._in_operations and len(stack) == 1:
                    self._in_operations = False
                    self._expecting_value = False
        fresh = self.operations[self._emitted :]
        self._emitted = len(self.operations)
        return self.target, fresh


# ---------------------------------------------------------------------------
# The guide (`prompt.ts`, `prompt-spec.ts`, `schema-render.ts`)

GENERATIVE_UI_WHEN_TO_SHOW = (
    "Show UI when it conveys the answer better than prose: to illustrate a concept (a diagram, "
    "a chart of how something changes), to compare options side by side, to let the user "
    "explore or adjust values, or to collect input. A small, focused surface next to your "
    "explanation often lands better than a long description. Reply in prose alone for a quick "
    "fact, a short answer, or conversation, and never add UI only as decoration."
)
_TOOL_INTRO = (
    f"Call `{GENERATIVE_UI_RENDER_TOOL}` to show UI. Arguments: `target` first, then "
    "`operations` (A2UI v1.0 operations, applied in order)."
)
# Each item is a rule, or (features, rules) for rules that apply only when every feature holds.
_PromptItem = str | tuple[tuple[str, ...], tuple[str, ...]]
_TOOL_OPERATIONS: tuple[_PromptItem, ...] = (
    '{"version":"1.0","createSurface":{"surfaceId":"<new id>","dataModel":{...},"components":'
    '[{"id":"root","component":"<Name>","children":["<child id>"]}]}}: the first operation of '
    'a new surface. "dataModel" and "components" are optional.',
    '{"version":"1.0","updateComponents":{"surfaceId":"<id>","components":[<component>, ...]}}: '
    "add or replace components by id.",
    '{"version":"1.0","updateDataModel":{"surfaceId":"<id>","path":"/some/path","value":<json>}}'
    ': set the value at "path". Always give "value". "value":null deletes the key at "path".',
    '{"version":"1.0","deleteSurface":{"surfaceId":"<id>"}}: remove the surface.',
    (
        ("agentCalls",),
        (
            '{"version":"1.0","callRendererFunction":{"functionCallId":"<unique id>",'
            '"callFunction":{"@call":"<function>","args":{...}}}}: run an app function now, '
            "with no click. It needs no surface.",
        ),
    ),
)
_TOOL_RULES: tuple[_PromptItem, ...] = (
    'Components are flat objects: {"id":"...","component":"<Name>", ...props}. Every surface '
    'renders from the component with id "root". Reference children by id in slot props.',
    'A component may take "accessibility":{"label":"<1 to 3 words>","description":"<what it '
    'does>"} for screen readers: on the component it describes, when nothing visible names it. '
    'Not on every component, and "live":"polite" only on text that changes by itself.',
    'Stream progressively: put the initial data in "dataModel" and the root in "components" of '
    "the createSurface operation, then send one updateComponents operation per child, so the UI "
    "appears while you are still writing. The root must already list the ids of its children in "
    'its slot props (for example "children":["card-1","card-2"]), even though the children come '
    "later. A component that no slot references is never shown.",
    "Updating a component replaces all of its props, so resend every prop.",
    'Prop values are literals or data bindings {"@path":"/data/path"}. Never write '
    '{"path":"/data/path"} as a binding.',
    (
        ("events", "functions"),
        (
            'Event props take an action. {"functionCall":{"@call":"<function>","args":{...}}} '
            "runs an app function in the browser immediately, and you are not told about it. "
            '{"event":{"name":"<name>","userMessage":"<text>","context":{...}}} sends the '
            'interaction back to you as a user message, with "userMessage" as its first line. '
            '"userMessage" is plain text: ${...} is not interpolated in it; put values in '
            '"context". Only call functions listed below.',
        ),
    ),
    (
        ("events", "noFunctions"),
        (
            'Event props take an action: {"event":{"name":"<name>","userMessage":"<text>",'
            '"context":{...}}} sends the interaction back to you as a user message, with '
            '"userMessage" as its first line. "userMessage" is plain text: ${...} is not '
            'interpolated in it; put values in "context".',
        ),
    ),
    "To show a different view, create a new surface with a new surfaceId (for example, a "
    "checkout form after a cart summary). Update an existing surface only when the user asks to "
    "change that same view: then do not send createSurface, use its surfaceId, and pass its "
    "existing target. Never reuse an earlier chat surface for a different view, because that "
    "replaces the earlier UI and anything the user typed into it.",
    "Never use a surfaceId again, also after deleteSurface.",
    'A prop can also be a function value that updates with the data: {"@call":"formatCurrency",'
    '"args":{"value":{"@path":"/total"},"currency":"EUR"}}. Only call functions listed below. '
    "formatString interpolates ${/path} and ${fn(arg: value)} in its value.",
    "${...} is evaluated only in the value of formatString and in the item of series; in other "
    "strings it stays literal text. Inside formatString, ${...} does not support operators. For "
    'arithmetic use calc, with the values as named args: {"@call":"calc","args":{"expression":'
    '"seats * 29 * (annual ? 0.8 : 1)","seats":{"@path":"/seats"},"annual":{"@path":"/annual"}}}.',
    "For a computed list (chart data, template items) use series. Its description under "
    "Functions gives the rules and an example.",
    (
        ("checks",),
        (
            'Validate an input with "checks": [{"condition":{"@call":"email","args":{"value":'
            '{"@path":"/form/email"}}},"message":"Enter a valid email"}]. The check functions '
            "are required, regex, length, numeric and email. A failed check shows the message "
            "under the input and disables a Button that has the same checks.",
        ),
    ),
    (
        ("templates",),
        (
            "To repeat a component for each item of a list, give a multiple slot a template: "
            '"children":{"componentId":"row","path":"/items"}. Inside the template, paths are '
            'relative to the item ("name", not "/name"). {"@call":"@index"} gives the position '
            'of the item, from 0; {"@call":"@index","args":{"offset":1}} counts from 1.',
        ),
    ),
    (
        ("agentCalls",),
        (
            "Give every callRendererFunction a new functionCallId. Call only a function marked "
            "(UI or agent) or (agent only); a function with no mark is for the UI only. A "
            "function marked (agent only) is only for callRendererFunction: do not bind an "
            "event to it.",
            "The result of a callRendererFunction comes back to you in a new turn, as a "
            'developer message: {"version":"1.0","rendererFunctionResponse":{"functionCallId":'
            '"<id>","value":...}}. If the call failed, it has "error" in place of "value". Do '
            "not wait for the result in this reply, and do not guess it.",
        ),
    ),
)


def _has_child_list(schema: Any) -> bool:
    if isinstance(schema, list):
        return any(_has_child_list(item) for item in schema)
    if not is_record(schema):
        return False
    if schema.get("$ref") == CHILD_LIST_REF:
        return True
    return any(_has_child_list(value) for value in schema.values())


def _prompt_features(manifest: GenerativeUIManifest) -> dict[str, bool]:
    """Which optional rule groups apply to the manifest (`generativeUIGuideFeatures`)."""
    components = list(manifest.components.values())
    functions = any(not is_basic_function(name) for name in manifest.functions)
    return {
        "functions": functions,
        "noFunctions": not functions,
        "events": any(len(c.get("events") or {}) > 0 for c in components),
        "templates": any(
            "multiple" in (c.get("slots") or {}).values() or _has_child_list(c["props"])
            for c in components
        ),
        "checks": any(
            is_record(c["props"].get("properties")) and "checks" in c["props"]["properties"]
            for c in components
        ),
        # `GENERATIVE_UI_AGENT_FUNCTION_CALLS` is off.
        "agentCalls": False,
    }


def _select(items: tuple[_PromptItem, ...], features: dict[str, bool]) -> list[str]:
    selected: list[str] = []
    for item in items:
        if isinstance(item, str):
            selected.append(item)
        elif all(features[feature] for feature in item[0]):
            selected.extend(item[1])
    return selected


def _one_line(text: str) -> str:
    return re.sub(r"\s*\n\s*", " ", text)


def _component_list(components: dict[str, Json]) -> str:
    """The component list of the tool guide, in the "json-schema" notation."""
    entries = []
    for name, component in components.items():
        description = component.get("description")
        lines = [
            f"- **{name}**" + (f": {_one_line(description)}" if description else ""),
            f"  props: {compact_json(component['props'])}",
        ]
        if component.get("events") is not None:
            lines.append(f"  event props: {compact_json(component['events'])}")
        if component.get("slots") is not None:
            lines.append(f"  slot props (component ids): {compact_json(component['slots'])}")
        entries.append("\n".join(lines))
    return "\n".join(entries)


def _shorten(text: str) -> str:
    if len(text) > _MAX_USER_VALUES_LENGTH:
        return text[:_MAX_USER_VALUES_LENGTH] + "..."
    return text


def build_generative_ui_prompt(manifest: GenerativeUIManifest) -> str:
    """The guide the runtime adds to a tool-transport run (`buildGenerativeUIPrompt`)."""
    targets = []
    for target in manifest.targets:
        place = (
            "inside the chat transcript" if target["kind"] == "chat" else "a named area of the app"
        )
        components = target.get("components")
        limit = (
            f"; only {', '.join(components) or 'no components'}" if components is not None else ""
        )
        description = f": {target['description']}" if target.get("description") else ""
        targets.append(f'- "{target["id"]}" ({place}{limit}){description}')
    functions = []
    for name, fn in manifest.functions.items():
        # A built-in function carries its short signature in the description of its parameters.
        signature = fn["parameters"].get("description")
        args = (
            signature
            if isinstance(signature, str)
            and signature.startswith("{")
            and len(fn["parameters"]) == 2
            else compact_json(fn["parameters"])
        )
        description = f": {fn['description']}" if fn.get("description") else ""
        functions.append(f"- **{name}**{description}\n  args: {args}")
    surfaces = []
    for surface_id, summary in manifest.surfaces.items():
        state = (
            ", deleted: never use this id again"
            if summary.get("status") == "deleted"
            else ", not created: send a corrected createSurface with this id"
            if summary.get("status") == "failed"
            else ""
        )
        lines = [f'- "{surface_id}" (target "{summary["target"]}"{state})']
        if summary.get("dataModel") is not None:
            lines.append(f"  user values: {_shorten(compact_json(summary['dataModel']))}")
        lines.extend(f"  rejected: {rejection}" for rejection in summary.get("rejected") or [])
        surfaces.append("\n".join(lines))
    has_notes = any(
        "dataModel" in summary or len(summary.get("rejected") or []) > 0
        for summary in manifest.surfaces.values()
    )
    notes = (
        "User values are what the user entered, by path. Your writes to those paths are ignored. "
        "Rejected operations were dropped: send them again with the problem fixed.\n"
        if has_notes
        else ""
    )
    features = _prompt_features(manifest)
    operations = "\n".join(f"- {op}" for op in _select(_TOOL_OPERATIONS, features))
    rules = "\n".join(
        f"{index}. {rule}" for index, rule in enumerate(_select(_TOOL_RULES, features), 1)
    )
    return "\n\n".join(
        [
            f"## Generative UI\n{_TOOL_INTRO}\n\n{GENERATIVE_UI_WHEN_TO_SHOW}\n\n"
            f'Every operation has "version":"1.0" and exactly one of:\n{operations}\n\n'
            f"Rules:\n{rules}",
            "### Targets\n" + ("\n".join(targets) or "- none"),
            "### Components\n" + (_component_list(manifest.components) or "- none"),
            "### Functions\n" + ("\n".join(functions) or "- none"),
            "### Existing surfaces\n" + notes + ("\n".join(surfaces) or "- none"),
        ]
    )


# ---------------------------------------------------------------------------
# The middleware (`generative-ui-middleware.ts`)


@dataclass
class _RenderCall:
    stream: RenderUIArgsStream = field(default_factory=RenderUIArgsStream)
    target: str | None = None
    buffered: list[Json | None] = field(default_factory=list)
    next_index: int = 0
    applied: int = 0
    rejected: list[Json] = field(default_factory=list)
    # Insertion-ordered set of the surfaces this call touched.
    touched: dict[str, None] = field(default_factory=dict)
    finished: bool = False


class GenerativeUIMiddleware:
    """Let an agent render generative UI surfaces with the `render_ui` tool.

    Each complete operation in the streamed arguments is validated against the client's
    catalog and committed at once: `ACTIVITY_SNAPSHOT` for a new surface, `ACTIVITY_DELTA`
    for every further operation on it. Create one per run.
    """

    def __init__(self, manifest: GenerativeUIManifest) -> None:
        self.manifest = manifest

    def prepare(self, input: Json) -> Json:
        """Add the `render_ui` tool and the generative UI guide; never mutates `input`."""
        tools = [
            tool
            for tool in input.get("tools") or []
            if tool.get("name") != GENERATIVE_UI_RENDER_TOOL
        ]
        tools.append(
            {
                "name": GENERATIVE_UI_RENDER_TOOL,
                "description": "Render or update generative UI surfaces, or call app functions, "
                "with A2UI v1.0 operations. Follow the generative UI guide in context.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "target": {
                            "type": "string",
                            "enum": [target["id"] for target in self.manifest.targets],
                            "description": 'Where the surface is shown: "chat" or a named '
                            "inline target.",
                        },
                        "operations": {
                            "type": "array",
                            "description": "A2UI v1.0 operations, applied in order.",
                            "items": {"type": "object"},
                        },
                    },
                    "required": ["target", "operations"],
                },
            }
        )
        context = [
            entry
            for entry in input.get("context") or []
            if entry.get("description") != GENERATIVE_UI_CONTEXT_DESCRIPTION
        ]
        context.append(
            {
                "description": GENERATIVE_UI_CONTEXT_DESCRIPTION,
                "value": build_generative_ui_prompt(self.manifest),
            }
        )
        return {**input, "tools": tools, "context": context}

    async def transform(self, source: AsyncIterator[Json], input: Json) -> AsyncIterator[Json]:
        """Turn `render_ui` calls into surface events and answer each call before RUN_FINISHED."""
        run = _SurfaceRun(self.manifest, input)
        held: Json | None = None
        try:
            async for event in source:
                if held is not None:
                    yield held
                    held = None
                if event.get("type") == "RUN_FINISHED":
                    held = event
                    run.answered_at_finish = set(run.answered)
                    continue
                for item in run.handle(event):
                    yield item
        except Exception:
            if held is not None:
                yield held
            raise
        for item in run.complete(held is not None):
            yield item
        if held is not None:
            yield held


class _SurfaceRun:
    """The surfaces, created ids and render_ui calls of one run."""

    def __init__(self, manifest: GenerativeUIManifest, input: Json) -> None:
        self.manifest = manifest
        # Only live surfaces take updates; a deleted or never-created one has a status.
        self.surfaces = {
            surface_id: summary["target"]
            for surface_id, summary in manifest.surfaces.items()
            if not summary.get("status")
        }
        # A surface id is unique for the life of the page. A failed create can be retried.
        self.created = {
            surface_id
            for surface_id, summary in manifest.surfaces.items()
            if summary.get("status") != "failed"
        }
        self.target_components = {
            target["id"]: tuple(target["components"])
            for target in manifest.targets
            if target.get("components") is not None
        }
        self.catalog_ids = manifest.catalog_ids or [manifest.catalog_id]
        self.calls: dict[str, _RenderCall] = {}
        self.answered = {
            message.get("toolCallId")
            for message in input.get("messages") or []
            if message.get("role") == "tool"
        }
        self.answered_at_finish: set[Any] = set()
        self.out: list[Json] = []

    def _patch(self, surface_id: str, ops: list[Json]) -> None:
        self.out.append(
            {
                "type": "ACTIVITY_DELTA",
                "messageId": surface_message_id(surface_id),
                "activityType": GENERATIVE_UI_ACTIVITY_TYPE,
                "patch": ops,
            }
        )

    def _begin_update(self, state: _RenderCall, surface_id: str) -> list[Json]:
        """Mark a surface streaming and clear its rejections the first time a call touches it."""
        if surface_id in state.touched:
            return []
        state.touched[surface_id] = None
        return [
            {"op": "replace", "path": "/status", "value": "streaming"},
            {"op": "replace", "path": "/rejected", "value": []},
        ]

    def _reject(self, state: _RenderCall, index: int, reason: str, surface_id: str | None) -> None:
        entry = {"index": index, "reason": reason}
        state.rejected.append(entry)
        if surface_id and surface_id in self.surfaces:
            self._patch(
                surface_id,
                [
                    *self._begin_update(state, surface_id),
                    {"op": "add", "path": "/rejected/-", "value": entry},
                ],
            )

    def _with_catalog_id(self, op: Json) -> Json:
        """A createSurface keeps a listed catalogId and gets the run's catalog otherwise."""
        create = op.get("createSurface")
        if not is_record(create):
            return op
        catalog_id = create.get("catalogId")
        if catalog_id not in self.catalog_ids:
            catalog_id = self.manifest.catalog_id
        return {**op, "createSurface": {**create, "catalogId": catalog_id}}

    def _process(self, state: _RenderCall, op: Json | None) -> None:
        index = state.next_index
        state.next_index += 1
        if op is None:
            self._reject(state, index, "operation is not valid JSON", None)
            return
        surface_id: str | None = None
        try:
            surface_id = operation_surface_id(op)
            self._apply(state, index, self._with_catalog_id(op), surface_id)
        except Exception as error:
            # One bad operation must not take down the run; the tool result reports it.
            self._reject(state, index, f"operation could not be processed: {error}", surface_id)

    def _apply(self, state: _RenderCall, index: int, op: Json, surface_id: str | None) -> None:
        kind = operation_kind(op)
        target = state.target if kind == "createSurface" else self.surfaces.get(surface_id or "")
        names = self.target_components.get(target) if target is not None else None
        reason = validate_operation(
            op,
            self.manifest,
            set(self.surfaces),
            self.created,
            self.manifest.functions,
            AllowedComponents(target, names) if target is not None and names is not None else None,
        )
        if reason:
            self._reject(state, index, reason, surface_id)
            return
        assert surface_id is not None
        if kind == "createSurface":
            self._create(state, index, surface_id, op)
            return
        self._patch(
            surface_id,
            [
                *self._begin_update(state, surface_id),
                {"op": "add", "path": "/operations/-", "value": op},
            ],
        )
        if kind == "deleteSurface":
            self.surfaces.pop(surface_id, None)
        state.applied += 1

    def _create(self, state: _RenderCall, index: int, surface_id: str, op: Json) -> None:
        target = state.target
        if target is None:
            self._reject(state, index, "render_ui was called without a target", None)
            return
        if not any(entry["id"] == target for entry in self.manifest.targets):
            self._reject(state, index, f'target "{target}" is not mounted', None)
            return
        self.surfaces[surface_id] = target
        self.created.add(surface_id)
        self.out.append(
            {
                "type": "ACTIVITY_SNAPSHOT",
                "messageId": surface_message_id(surface_id),
                "activityType": GENERATIVE_UI_ACTIVITY_TYPE,
                "content": {
                    "surfaceId": surface_id,
                    "target": target,
                    "catalogId": op["createSurface"].get("catalogId") or self.manifest.catalog_id,
                    "operations": [op],
                    "status": "streaming",
                    "rejected": [],
                },
                "replace": True,
            }
        )
        state.touched[surface_id] = None
        state.applied += 1

    def _accept(self, state: _RenderCall, op: Json | None) -> None:
        """Hold operations until the target is known."""
        if state.target is None:
            state.buffered.append(op)
        else:
            self._process(state, op)

    def _recover(self, state: _RenderCall) -> None:
        """Recover operations that the model sent as a JSON-encoded string."""
        try:
            args = json.loads(state.stream.text, parse_constant=_reject_constant)
        except ValueError:
            return
        if not is_record(args):
            return
        if state.target is None and isinstance(args.get("target"), str):
            state.target = args["target"]
        operations = args.get("operations")
        if isinstance(operations, str):
            try:
                operations = json.loads(operations, parse_constant=_reject_constant)
            except ValueError:
                return
        if not isinstance(operations, list):
            return
        for op in operations:
            self._accept(state, op if is_record(op) else None)

    def _finish(self, state: _RenderCall) -> None:
        if state.finished:
            return
        state.finished = True
        if state.next_index == 0 and not state.buffered:
            self._recover(state)
        if state.target is None:
            # Function calls need no target; every other operation is rejected.
            buffered, state.buffered = state.buffered, []
            for op in buffered:
                if operation_kind(op) == "callRendererFunction":
                    self._process(state, op)
                    continue
                state.rejected.append(
                    {"index": state.next_index, "reason": "render_ui was called without a target"}
                )
                state.next_index += 1
        if state.stream.has_incomplete_operation:
            # The arguments ended inside an element, for example at the output limit.
            state.rejected.append({"index": state.next_index, "reason": "operation was truncated"})
            state.next_index += 1
        for surface_id in state.touched:
            self._patch(surface_id, [{"op": "replace", "path": "/status", "value": "ready"}])

    def handle(self, event: Json) -> list[Json]:
        """Pass one event through and return it with the surface events it caused."""
        self.out = [event]
        kind, call_id = event.get("type"), event.get("toolCallId")
        if not isinstance(call_id, str):
            return self.out
        if kind == "TOOL_CALL_RESULT":
            self.answered.add(call_id)
        elif kind == "TOOL_CALL_START" and event.get("toolCallName") == GENERATIVE_UI_RENDER_TOOL:
            self.calls[call_id] = _RenderCall()
        elif kind == "TOOL_CALL_ARGS" and call_id in self.calls:
            state = self.calls[call_id]
            delta = event.get("delta")
            if not state.finished and isinstance(delta, str):
                target, operations = state.stream.push(delta)
                if target is not None and state.target is None:
                    state.target = target
                    buffered, state.buffered = state.buffered, []
                    for op in buffered:
                        self._process(state, op)
                for op in operations:
                    self._accept(state, op)
        elif kind == "TOOL_CALL_END" and call_id in self.calls:
            self._finish(self.calls[call_id])
        return self.out

    def complete(self, finished: bool) -> list[Json]:
        """Finish every call and, before a held RUN_FINISHED, answer the unanswered ones."""
        self.out = []
        for state in self.calls.values():
            self._finish(state)
        if not finished:
            return self.out
        for call_id, state in self.calls.items():
            if call_id in self.answered_at_finish:
                continue
            nothing = state.applied == 0 and not state.rejected
            result: Json = (
                {
                    "status": "error",
                    "applied": 0,
                    "calls": 0,
                    "rejected": [],
                    "reason": "operations must be a JSON array of A2UI operation objects; "
                    "nothing was rendered",
                }
                if nothing
                else {
                    "status": "rendered",
                    "applied": state.applied,
                    "calls": 0,
                    "rejected": state.rejected,
                }
            )
            self.out.append(
                {
                    "type": "TOOL_CALL_RESULT",
                    "messageId": str(uuid4()),
                    "toolCallId": call_id,
                    "content": compact_json(result),
                }
            )
        return self.out
