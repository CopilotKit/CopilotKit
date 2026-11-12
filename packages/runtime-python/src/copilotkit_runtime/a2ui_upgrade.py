"""Serve A2UI v0.9 agents through the A2UI 1.0 client.

Ports `a2ui-v09-operations.ts`, `a2ui-v09-actions.ts`, `a2ui-v09-catalog.ts` and
`a2ui-v09-middleware.ts` of the TypeScript runtime:
- v0.9 `a2ui-surface` activity events become 1.0 `generative-ui-surface` events;
- a click on a converted surface reaches the agent as the v0.9 `a2uiAction`;
- a 0.9 agent gets the v0.9 component schema of the client's catalog.
"""

import copy
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from .a2ui import SCHEMA_DESCRIPTION
from .generative_ui import (
    A2UI_BASIC_FUNCTIONS,
    A2UI_VERSION,
    GENERATIVE_UI_ACTIVITY_TYPE,
    GENERATIVE_UI_CHAT_TARGET,
    STANDARD_CATALOG_ID,
    A2UIVersion,
    child_ref_kind,
    compact_json,
    envelope_to_manifest,
    function_callers,
    is_record,
    read_envelope,
    surface_message_id,
)
from .models import Json

_UNSET: Any = object()

# ---------------------------------------------------------------------------
# Operations (`a2ui-v09-operations.ts`)

V09_SURFACE_ACTIVITY_TYPE = "a2ui-surface"
_OPERATIONS_KEY = "a2ui_operations"
_V09_VERSIONS = {"v0.9", "v0.9.1"}
_V09_KINDS = ("createSurface", "updateComponents", "updateDataModel", "deleteSurface")
_V09_BASIC_CATALOG_IDS = {
    "https://a2ui.org/specification/v0_9/basic_catalog.json",
    "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
}
# The A2UI 1.0 basic catalog, which native 1.0 agents (for example ADK) send. It has the
# 18 components of the v0.9 basic catalog with 1.0 bindings, so it becomes the standard
# catalog too.
_V10_BASIC_CATALOG_IDS = {"https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"}
# v0.9 `Text` heading variants as 1.0 `Title` sizes, largest first.
_HEADING_SIZES = {"h1": "2xl", "h2": "xl", "h3": "lg", "h4": "md", "h5": "sm"}


class _Failed(Exception):
    """Why an operation cannot be converted."""


def _v09_kind(op: Json) -> str | None:
    kinds = [kind for kind in _V09_KINDS if kind in op]
    return kinds[0] if len(kinds) == 1 else None


def is_v09_operation(value: Any) -> bool:
    """True for an A2UI v0.9 operation, also one without `version` but with one v0.9 key."""
    if not is_record(value):
        return False
    if "version" in value:
        return isinstance(value["version"], str) and value["version"] in _V09_VERSIONS
    kind = _v09_kind(value)
    return kind is not None and is_record(value[kind])


def _convert_value(value: Any) -> Any:
    """`{ path }` becomes `{ "@path" }` and `{ call, args }` becomes `{ "@call", args }`."""
    if isinstance(value, list):
        return [_convert_value(item) for item in value]
    if not is_record(value):
        return value
    if len(value) == 1 and isinstance(value.get("path"), str):
        return {"@path": value["path"]}
    if isinstance(value.get("call"), str) and all(
        key in ("call", "args", "returnType") for key in value
    ):
        return _convert_call(value)
    return {key: _convert_value(item) for key, item in value.items()}


def _convert_call(call: Json) -> Json:
    result: Json = {"@call": call["call"]}
    if "args" in call:
        result["args"] = _convert_value(call["args"])
    return result


def _is_v09_action(value: Any) -> bool:
    return (
        is_record(value)
        and len(value) == 1
        and (is_record(value.get("event")) or is_record(value.get("functionCall")))
    )


def _convert_action(action: Any) -> Json:
    """A v0.9 action as a 1.0 `{ event }` or `{ functionCall }` binding."""
    if not _is_v09_action(action):
        raise _Failed('action must be { "event": ... } or { "functionCall": ... }')
    if is_record(action.get("functionCall")):
        call = action["functionCall"]
        if not isinstance(call.get("call"), str) or not call["call"]:
            raise _Failed("action.functionCall.call must be a function name")
        return {"functionCall": _convert_call(call)}
    event = action["event"]
    if not isinstance(event.get("name"), str) or not event["name"]:
        raise _Failed("action.event.name is required")
    converted: Json = {"name": event["name"]}
    if "context" in event:
        converted["context"] = _convert_value(event["context"])
    return {"event": converted}


def _basic_catalog_changes(node: Json) -> Json:
    """The props of the basic catalog that the 1.0 standard catalog names differently.

    `Text` with a heading `variant` becomes `Title` (h1 "2xl" to h5 "sm"), with `caption`
    it becomes `Caption`; `variant` goes, and `weight` too for Title and Caption.
    `Button.action` becomes `onClick`. `TextField.validationRegexp` becomes a `regex` check.
    """
    if node["component"] == "Text" and "variant" in node:
        rest = {key: value for key, value in node.items() if key != "variant"}
        variant = node["variant"]
        size = _HEADING_SIZES.get(variant) if isinstance(variant, str) else None
        if size is not None:
            title = {key: value for key, value in rest.items() if key != "weight"}
            title["component"] = "Title"
            title["size"] = size
            return title
        if variant == "caption":
            caption = {key: value for key, value in rest.items() if key != "weight"}
            caption["component"] = "Caption"
            return caption
        return rest
    if node["component"] == "Button" and "action" in node:
        rest = {key: value for key, value in node.items() if key != "action"}
        rest["onClick"] = node["action"]
        return rest
    if node["component"] == "TextField" and "validationRegexp" in node:
        rest = {key: value for key, value in node.items() if key != "validationRegexp"}
        pattern = node["validationRegexp"]
        if not isinstance(pattern, str) or "value" not in rest:
            return rest
        check = {
            "condition": {"@call": "regex", "args": {"value": rest["value"], "pattern": pattern}}
        }
        checks = rest["checks"] if isinstance(rest.get("checks"), list) else []
        rest["checks"] = [*checks, check]
        return rest
    return node


def _convert_component(node: Any) -> Json:
    """One v0.9 component (flat format) as a 1.0 component node."""
    if not is_record(node) or not isinstance(node.get("id"), str) or not node["id"]:
        raise _Failed("a component needs a string id")
    if not isinstance(node.get("component"), str) or not node["component"]:
        raise _Failed(
            f'component "{node["id"]}": the component type must be a string (the v0.9 flat format)'
        )
    converted: Json = {}
    for key, value in node.items():
        if key in ("id", "component"):
            converted[key] = value
        elif key == "action" or _is_v09_action(value):
            try:
                converted[key] = _convert_action(value)
            except _Failed as error:
                raise _Failed(f'component "{node["id"]}": {error}') from None
        else:
            converted[key] = _convert_value(value)
    return _basic_catalog_changes(converted)


def _convert_update_data_model(payload: Json, surface_id: str) -> Json:
    """v0.9 removes the key when `value` is left out; 1.0 removes it for null."""
    path = payload.get("path", _UNSET)
    if path is not _UNSET and not isinstance(path, str):
        raise _Failed("updateDataModel.path must be a string")
    relative = path if isinstance(path, str) else ""
    pointer = relative if relative.startswith("/") else f"/{relative}"
    is_root = pointer == "/"
    value = payload.get("value", _UNSET)
    if is_root and value is not _UNSET and not is_record(value):
        raise _Failed("a root updateDataModel value must be a JSON object in A2UI 1.0")
    if value is _UNSET:
        value = {} if is_root else None
    return {
        "version": A2UI_VERSION,
        "updateDataModel": {"surfaceId": surface_id, "path": pointer, "value": value},
    }


def _convert_create_surface(payload: Json, surface_id: str) -> Json:
    """The basic catalog id becomes the standard catalog id; `theme` has no 1.0 field."""
    create: Json = {"surfaceId": surface_id}
    catalog_id = payload.get("catalogId")
    if isinstance(catalog_id, str) and catalog_id:
        create["catalogId"] = (
            STANDARD_CATALOG_ID if catalog_id in _V09_BASIC_CATALOG_IDS else catalog_id
        )
    send = payload.get("sendDataModel")
    if send is None:
        send = payload.get("attachDataModel")
    if isinstance(send, bool):
        create["sendDataModel"] = send
    return {"version": A2UI_VERSION, "createSurface": create}


def _standard_components(components: Any) -> Any:
    """Basic catalog components as standard ones; anything else stays."""
    if not isinstance(components, list):
        return components
    return [
        _basic_catalog_changes(node) if is_record(node) and "component" in node else node
        for node in components
    ]


def _upgrade_v10_operation(op: Json) -> Json:
    """A native A2UI 1.0 operation, for the standard catalog.

    The 1.0 basic catalog id becomes the standard catalog id, and the basic catalog
    components (inline in createSurface, or in updateComponents) get the changes of
    `_basic_catalog_changes`. Bindings are already 1.0. Everything else stays; the client
    validates the operation.
    """
    create = op.get("createSurface")
    if is_record(create):
        create = dict(create)
        if (
            isinstance(create.get("catalogId"), str)
            and create["catalogId"] in _V10_BASIC_CATALOG_IDS
        ):
            create["catalogId"] = STANDARD_CATALOG_ID
        if "components" in create:
            create["components"] = _standard_components(create["components"])
        return {**op, "createSurface": create}
    update = op.get("updateComponents")
    if is_record(update):
        update = dict(update)
        if "components" in update:
            update["components"] = _standard_components(update["components"])
        return {**op, "updateComponents": update}
    return op


def _upgrade_operation(op: Any) -> Json:
    if not is_record(op):
        raise _Failed("operation must be a JSON object")
    if op.get("version", _UNSET) == A2UI_VERSION:
        return _upgrade_v10_operation(op)
    if not is_v09_operation(op):
        version = op.get("version")
        raise _Failed(
            f'unsupported A2UI version "{version}"; only v0.9 and 1.0 operations are supported'
            if isinstance(version, str)
            else "not an A2UI v0.9 operation: it needs exactly one of " + ", ".join(_V09_KINDS)
        )
    kind = _v09_kind(op)
    if kind is None:
        raise _Failed("operation must contain exactly one of " + ", ".join(_V09_KINDS))
    payload = op[kind]
    if (
        not is_record(payload)
        or not isinstance(payload.get("surfaceId"), str)
        or not payload["surfaceId"]
    ):
        raise _Failed(f"{kind}.surfaceId is required")
    surface_id = payload["surfaceId"]
    if kind == "createSurface":
        return _convert_create_surface(payload, surface_id)
    if kind == "updateComponents":
        components = payload.get("components")
        if not isinstance(components, list) or not components:
            raise _Failed("updateComponents.components must be a non-empty array")
        return {
            "version": A2UI_VERSION,
            "updateComponents": {
                "surfaceId": surface_id,
                "components": [_convert_component(component) for component in components],
            },
        }
    if kind == "updateDataModel":
        return _convert_update_data_model(payload, surface_id)
    return {"version": A2UI_VERSION, "deleteSurface": {"surfaceId": surface_id}}


def upgrade_v09_operations(operations: Any) -> tuple[list[Json], list[tuple[Any, str]]]:
    """Convert A2UI v0.9 operations to 1.0, in order. Never raises.

    A native 1.0 operation keeps its form: only the 1.0 basic catalog id becomes the
    standard catalog id, and its basic catalog components get the same changes as v0.9
    ones. Any other operation, and a v0.9 operation that cannot be converted, is returned
    in the second list with the reason.
    """
    upgraded: list[Json] = []
    dropped: list[tuple[Any, str]] = []
    for operation in operations if isinstance(operations, list) else []:
        try:
            upgraded.append(_upgrade_operation(operation))
        except _Failed as error:
            dropped.append((operation, str(error)))
        except Exception as error:
            dropped.append((operation, f"operation could not be read: {error}"))
    return upgraded, dropped


def _surface_id_of(op: Any) -> str | None:
    """The nested `surfaceId` of a v0.9 or 1.0 surface operation."""
    if not is_record(op):
        return None
    for kind in _V09_KINDS:
        payload = op.get(kind)
        if is_record(payload) and isinstance(payload.get("surfaceId"), str):
            return payload["surfaceId"] or None
    return None


_MAX_REJECTION_LENGTH = 500


def _failed_lifecycle_error(content: Any) -> str | None:
    """The error of a `failed` lifecycle snapshot (the agent's A2UI recovery gave up), or None."""
    if not is_record(content) or content.get("status") != "failed":
        return None
    error = content.get("error")
    if not isinstance(error, str) or not error:
        error = "A2UI generation failed"
    return error[:_MAX_REJECTION_LENGTH]


def _read_operations(content: Any) -> list[Any]:
    if not is_record(content):
        return []
    operations = content.get(_OPERATIONS_KEY)
    if operations is None:
        operations = content.get("operations")
    return operations if isinstance(operations, list) else []


_FORBIDDEN_SEGMENTS = {"__proto__", "constructor", "prototype"}


def _segments(pointer: str) -> list[str]:
    if pointer == "":
        return []
    if not pointer.startswith("/"):
        raise ValueError(f'invalid pointer "{pointer}"')
    return [part.replace("~1", "/").replace("~0", "~") for part in pointer[1:].split("/")]


def _index(key: str) -> int | None:
    return int(key) if re.fullmatch(r"\d+", key) else None


def apply_json_patch(document: Any, patch: Any) -> Any:
    """Apply RFC 6902 operations to `document` in place and return the new root.

    Raises on a path that does not resolve, so a bad delta leaves stored content alone.
    """
    if not isinstance(patch, list):
        raise ValueError("patch must be an array")
    root = [document]

    def parent_of(pointer: str) -> tuple[Any, str | None]:
        segments = _segments(pointer)
        key = segments.pop() if segments else None
        parent = root[0]
        for segment in segments:
            if segment in _FORBIDDEN_SEGMENTS:
                raise ValueError("forbidden path")
            if isinstance(parent, list):
                index = _index(segment)
                parent = parent[index] if index is not None and index < len(parent) else _UNSET
            else:
                parent = parent.get(segment, _UNSET) if is_record(parent) else _UNSET
            if parent is _UNSET:
                raise ValueError(f'path "{pointer}" not found')
        if key is not None and key in _FORBIDDEN_SEGMENTS:
            raise ValueError("forbidden path")
        return parent, key

    def read(pointer: str) -> Any:
        parent, key = parent_of(pointer)
        if key is None:
            return root[0]
        if isinstance(parent, list):
            index = _index(key)
            return parent[index] if index is not None and index < len(parent) else _UNSET
        return parent.get(key, _UNSET) if is_record(parent) else _UNSET

    def remove(pointer: str) -> None:
        parent, key = parent_of(pointer)
        if key is None:
            raise ValueError("cannot remove the root")
        if isinstance(parent, list):
            index = _index(key)
            if index is None:
                raise ValueError(f'path "{pointer}" not found')
            del parent[index : index + 1]
        elif is_record(parent) and key in parent:
            del parent[key]
        else:
            raise ValueError(f'path "{pointer}" not found')

    def write(pointer: str, value: Any, insert: bool) -> None:
        if value is _UNSET:
            raise ValueError(f'path "{pointer}" has no value')
        parent, key = parent_of(pointer)
        if key is None:
            root[0] = value
        elif isinstance(parent, list):
            index = len(parent) if key == "-" else _index(key)
            if index is None or index > len(parent):
                raise ValueError(f'index "{key}" is out of range')
            parent[index : index if insert else index + 1] = [value]
        elif is_record(parent):
            parent[key] = value
        else:
            raise ValueError(f'path "{pointer}" not found')

    for entry in patch:
        if not is_record(entry) or not isinstance(entry.get("path"), str):
            raise ValueError("invalid patch operation")
        op, path, source = entry.get("op"), entry["path"], entry.get("from") or ""
        if op == "add":
            write(path, copy.deepcopy(entry.get("value")), True)
        elif op == "replace":
            if read(path) is _UNSET:
                raise ValueError(f'path "{path}" not found')
            write(path, copy.deepcopy(entry.get("value")), False)
        elif op == "remove":
            remove(path)
        elif op == "copy":
            write(path, copy.deepcopy(read(source)), True)
        elif op == "move":
            value = read(source)
            remove(source)
            write(path, value, True)
        elif op == "test":
            if compact_json(read(path)) != compact_json(entry.get("value")):
                raise ValueError(f'test failed at "{path}"')
        else:
            raise ValueError(f'unknown patch op "{op}"')
    return root[0]


@dataclass
class _SourcePart:
    # (converted operation, index in the source message, "0.9" or "1.0").
    operations: list[tuple[Json, int, str]] = field(default_factory=list)
    rejected: list[Json] = field(default_factory=list)


@dataclass
class _SurfaceState:
    # The part of each source message, in the order they first touched the surface.
    parts: dict[Any, _SourcePart] = field(default_factory=dict)
    last_snapshot: str | None = None
    # Operations sent as deltas, for a surface created in an earlier run.
    sent_operations: list[Json] = field(default_factory=list)
    sent_rejected: str = "[]"


class A2UIV09ActivityUpgrader:
    """Convert the `a2ui-surface` surfaces of one run (A2UI v0.9, or native 1.0) to
    `generative-ui-surface` surfaces. Create one per run.

    An `a2ui-surface` snapshot or delta is kept per messageId and its operations converted.
    Each surface becomes one `genui:<surfaceId>` message: a surface created in this run is
    sent as a cumulative snapshot (chat target, status "ready", `a2uiSourceVersion` "0.9"
    for a surface written in v0.9); a surface that this run only updates gets its new
    operations as an `ACTIVITY_DELTA`. A surface written in native 1.0 (for example by
    ADK) has no `a2uiSourceVersion`, so a click on it reaches the agent unchanged. One
    surface has one version, the version of its first operation; an operation of the other
    version is rejected. A lifecycle snapshot (no operations) names no surface, so it is
    consumed. A `failed` one (the agent's recovery gave up) becomes a surface with no
    operations, status "error", and its error as the one rejected entry, so the chat shows
    that the UI could not be made. Its surfaceId is the source messageId.
    """

    def __init__(self) -> None:
        self._sources: dict[Any, Any] = {}
        self._surfaces: dict[str, _SurfaceState] = {}
        # The source messages whose `failed` snapshot was sent.
        self._failures: set[str] = set()

    def _failure(self, message_id: str, error: str) -> list[Json]:
        """The surface that shows a failed lifecycle snapshot, sent once."""
        if message_id in self._failures:
            return []
        self._failures.add(message_id)
        content: Json = {
            "surfaceId": message_id,
            "target": GENERATIVE_UI_CHAT_TARGET,
            "catalogId": STANDARD_CATALOG_ID,
            "operations": [],
            "status": "error",
            "rejected": [{"index": 0, "reason": error}],
            "a2uiSourceVersion": "0.9",
        }
        return [
            {
                "type": "ACTIVITY_SNAPSHOT",
                "messageId": surface_message_id(message_id),
                "activityType": GENERATIVE_UI_ACTIVITY_TYPE,
                "content": content,
                "replace": True,
            }
        ]

    def _snapshot(
        self,
        surface_id: str,
        state: _SurfaceState,
        operations: list[Json],
        rejected: list[Json],
        version: str,
    ) -> list[Json]:
        create = next((op for op in operations if "createSurface" in op), None)
        catalog_id = (
            create["createSurface"].get("catalogId")
            if create and is_record(create["createSurface"])
            else None
        ) or STANDARD_CATALOG_ID
        content: Json = {
            "surfaceId": surface_id,
            "target": GENERATIVE_UI_CHAT_TARGET,
            "catalogId": catalog_id,
            "operations": operations,
            "status": "ready",
            "rejected": rejected,
        }
        if version == "0.9":
            content["a2uiSourceVersion"] = "0.9"
        serialized = compact_json(content)
        if serialized == state.last_snapshot:
            return []
        state.last_snapshot = serialized
        return [
            {
                "type": "ACTIVITY_SNAPSHOT",
                "messageId": surface_message_id(surface_id),
                "activityType": GENERATIVE_UI_ACTIVITY_TYPE,
                "content": copy.deepcopy(content),
                "replace": True,
            }
        ]

    def _delta(
        self, surface_id: str, state: _SurfaceState, operations: list[Json], rejected: list[Json]
    ) -> list[Json]:
        sent = state.sent_operations
        same = 0
        while (
            same < len(sent)
            and same < len(operations)
            and compact_json(sent[same]) == compact_json(operations[same])
        ):
            same += 1
        # Operations that changed after they were sent cannot be taken back. v0.9 updates
        # replace by id or path, so sending them again is safe.
        patch: list[Json] = [
            {"op": "add", "path": "/operations/-", "value": copy.deepcopy(op)}
            for op in operations[same:]
        ]
        serialized = compact_json(rejected)
        if serialized != state.sent_rejected:
            patch.append({"op": "replace", "path": "/rejected", "value": rejected})
        state.sent_operations = operations
        state.sent_rejected = serialized
        if not patch:
            return []
        return [
            {
                "type": "ACTIVITY_DELTA",
                "messageId": surface_message_id(surface_id),
                "activityType": GENERATIVE_UI_ACTIVITY_TYPE,
                "patch": patch,
            }
        ]

    def _emit(self, surface_id: str) -> list[Json]:
        state = self._surfaces.get(surface_id)
        if state is None:
            return []
        operations: list[Json] = []
        rejected: list[Json] = []
        created = False
        version: str | None = None
        for part in state.parts.values():
            for op, index, op_version in part.operations:
                if version is None:
                    version = op_version
                if op_version != version:
                    rejected.append(
                        {
                            "index": index,
                            "reason": f'surface "{surface_id}" is A2UI {version}; '
                            f"an A2UI {op_version} operation cannot change it",
                        }
                    )
                    continue
                if "createSurface" in op:
                    # A second createSurface of the same id is rejected in 1.0.
                    if created:
                        continue
                    created = True
                operations.append(op)
            rejected.extend(part.rejected)
        if created:
            return self._snapshot(surface_id, state, operations, rejected, version or "0.9")
        return self._delta(surface_id, state, operations, rejected)

    def _refresh(self, message_id: Any) -> list[Json]:
        """Convert the stored content of one source message again."""
        parts: dict[str, _SourcePart] = {}
        for index, op in enumerate(_read_operations(self._sources.get(message_id))):
            # An operation with no surface cannot be shown anywhere.
            surface_id = _surface_id_of(op)
            if surface_id is None:
                continue
            part = parts.setdefault(surface_id, _SourcePart())
            operations, dropped = upgrade_v09_operations([op])
            # Only v0.9 and 1.0 operations convert.
            version = "1.0" if is_record(op) and op.get("version") == A2UI_VERSION else "0.9"
            part.operations.extend((operation, index, version) for operation in operations)
            part.rejected.extend({"index": index, "reason": reason} for _, reason in dropped)
        touched = dict.fromkeys(parts)
        for surface_id, state in self._surfaces.items():
            if surface_id not in parts and state.parts.pop(message_id, None) is not None:
                touched[surface_id] = None
        for surface_id, part in parts.items():
            self._surfaces.setdefault(surface_id, _SurfaceState()).parts[message_id] = part
        events = [event for surface_id in touched for event in self._emit(surface_id)]
        error = _failed_lifecycle_error(self._sources.get(message_id))
        if error is not None and isinstance(message_id, str):
            events.extend(self._failure(message_id, error))
        return events

    def transform(self, event: Json) -> list[Json]:
        """The events that replace one event of the run."""
        kind = event.get("type")
        if kind == "ACTIVITY_SNAPSHOT":
            if event.get("activityType") != V09_SURFACE_ACTIVITY_TYPE:
                return [event]
            message_id = event.get("messageId")
            # `replace: false` does not replace a message that already exists.
            if event.get("replace") is False and message_id in self._sources:
                return []
            self._sources[message_id] = copy.deepcopy(event.get("content"))
            return self._refresh(message_id)
        if kind == "ACTIVITY_DELTA":
            if event.get("activityType") != V09_SURFACE_ACTIVITY_TYPE:
                return [event]
            message_id = event.get("messageId")
            if message_id not in self._sources:
                return []
            try:
                content = apply_json_patch(
                    copy.deepcopy(self._sources[message_id]), event.get("patch")
                )
            except (ValueError, TypeError, AttributeError):
                # The AG-UI client also skips a delta that does not apply.
                return []
            self._sources[message_id] = content
            return self._refresh(message_id)
        return [event]


async def upgrade_v09_activities(source: AsyncIterator[Json]) -> AsyncIterator[Json]:
    """Pass a run's events through one `A2UIV09ActivityUpgrader`."""
    upgrader = A2UIV09ActivityUpgrader()
    async for event in source:
        for item in upgrader.transform(event):
            yield item


# ---------------------------------------------------------------------------
# Clicks (`a2ui-v09-actions.ts`)


def _read_action(envelope: Json | None) -> Json | None:
    """The 1.0 action of the user event that started the run, as a v0.9 user action."""
    message = envelope["metadata"]["extensions"].get("copilotkit_action") if envelope else None
    if not is_record(message) or not is_record(message.get("action")):
        return None
    action = message["action"]
    name, surface_id = action.get("name"), action.get("surfaceId")
    if not isinstance(name, str) or not isinstance(surface_id, str):
        return None
    source, context, timestamp = (
        action.get("sourceComponentId"),
        action.get("context"),
        action.get("timestamp"),
    )
    return {
        "name": name,
        "surfaceId": surface_id,
        "sourceComponentId": source if isinstance(source, str) else "",
        "context": context if is_record(context) else {},
        "timestamp": timestamp
        if isinstance(timestamp, str)
        else datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    }


def _is_v09_surface(
    envelope: Json, messages: list[Any], surface_id: str, agent_version: A2UIVersion
) -> bool:
    """True when the surface was converted from v0.9.

    The client's surface summary decides (no `a2uiSourceVersion` means a 1.0 surface),
    then the last `generative-ui-surface` activity message of the surface, then
    `agent_version`.
    """
    summary = envelope["metadata"]["extensions"]["copilotkit_surfaces"].get(surface_id)
    if is_record(summary):
        return bool(summary.get("a2uiSourceVersion") == "0.9")
    for message in reversed(messages):
        if (
            is_record(message)
            and message.get("role") == "activity"
            and message.get("activityType") == GENERATIVE_UI_ACTIVITY_TYPE
            and is_record(message.get("content"))
            and message["content"].get("surfaceId") == surface_id
        ):
            return bool(message["content"].get("a2uiSourceVersion") == "0.9")
    return agent_version == "0.9"


def downgrade_v09_action(input: Json, agent_version: A2UIVersion = "1.0") -> Json:
    """Turn a click on a surface of v0.9 origin into the v0.9 action of the agent side.

    The 1.0 client sends a click as a visible user message plus
    `copilotkit_action` in the envelope. For a surface of v0.9 origin this returns a new
    input with `forwardedProps.a2uiAction.userAction` set and that user message removed,
    as the v0.9 client sent no message for a click. Otherwise it returns `input`.
    """
    forwarded = input.get("forwardedProps")
    # A run that already has a v0.9 action keeps it.
    if not is_record(forwarded) or "a2uiAction" in forwarded:
        return input
    envelope = read_envelope(forwarded)
    action = _read_action(envelope)
    if envelope is None or action is None:
        return input
    messages = input.get("messages") or []
    if not _is_v09_surface(envelope, messages, action["surfaceId"], agent_version):
        return input
    last = messages[-1] if messages else None
    # The client adds the visible click message just before the run.
    if is_record(last) and last.get("role") == "user" and isinstance(last.get("content"), str):
        messages = messages[:-1]
    return {
        **input,
        "messages": messages,
        "forwardedProps": {**forwarded, "a2uiAction": {"userAction": action}},
    }


# ---------------------------------------------------------------------------
# Catalog (`a2ui-v09-catalog.ts`)

_V09_BASIC_CATALOG_ID = "https://a2ui.org/specification/v0_9/basic_catalog.json"
_CAPABILITIES_DESCRIPTION = (
    "A2UI catalog capabilities: available catalog IDs and custom component definitions the "
    "client can render."
)
_GENERATION_GUIDELINES_DESCRIPTION = (
    "A2UI generation guidelines — protocol rules, tool arguments, path rules, data model "
    "format, and form/two-way-binding instructions."
)
_DESIGN_GUIDELINES_DESCRIPTION = (
    "A2UI design guidelines — visual design rules, component hierarchy tips, and action "
    "handler patterns."
)
# The components of the v0.9 basic catalog. The 1.0 standard catalog has each of them.
_V09_BASIC_COMPONENTS = (
    "Text",
    "Image",
    "Icon",
    "Video",
    "AudioPlayer",
    "Row",
    "Column",
    "List",
    "Card",
    "Tabs",
    "Modal",
    "Divider",
    "Button",
    "TextField",
    "CheckBox",
    "ChoicePicker",
    "Slider",
    "DateTimeInput",
)
# The components of the 1.0 standard catalog (`standardDeclarations`).
_STANDARD_COMPONENTS = frozenset(
    (
        "Box Column Row Grid GridItem Card Flow FlowItem Carousel CarouselItem CarouselMediaItem "
        "Spacer Divider Tabs Title Text Caption Label Bold Italic Underline Strikethrough Badge "
        "Blockquote Code Markdown Math ShimmerText Link Tooltip Button Pressable Form TextField "
        "TextArea Select CheckBox Radio RadioGroup Slider SegmentedControl ChoicePicker "
        "DateTimeInput PulseIndicator FlashcardFlip Popover PopoverTrigger PopoverContent Modal "
        "Table TableSection TableRow TableCell List ListItem Chart Map Image Icon Favicon Svg "
        "Video AudioPlayer HtmlView LinkCard Citation FollowUp EntityCard ImageGrid"
    ).split()
)
# Props of standard components that v0.9 names differently: component → 1.0 → v0.9 name.
_V10_TO_V09_PROP_NAMES = {"Button": {"onClick": "action"}}
_COMMON = "common_types.json#/$defs/"


def _ref(name: str) -> Json:
    return {"$ref": f"{_COMMON}{name}"}


# The v0.9 common types that the schemas reference, so every ref resolves in the payload.
_V09_COMMON_TYPES: Json = {
    "ComponentId": {
        "type": "string",
        "description": "The unique identifier for a component, used for both definitions and "
        "references within the same surface.",
    },
    "ComponentCommon": {
        "type": "object",
        "properties": {"id": _ref("ComponentId"), "accessibility": _ref("AccessibilityAttributes")},
        "required": ["id"],
    },
    "AccessibilityAttributes": {
        "type": "object",
        "description": "Attributes to enhance accessibility when using assistive technologies "
        "like screen readers.",
        "properties": {"label": _ref("DynamicString"), "description": _ref("DynamicString")},
    },
    "ChildList": {
        "oneOf": [
            {
                "type": "array",
                "items": _ref("ComponentId"),
                "description": "A static list of child component IDs.",
            },
            {
                "type": "object",
                "description": "A template for generating a dynamic list of children from a data "
                "model list. The `componentId` is the component to use as a template.",
                "properties": {
                    "componentId": _ref("ComponentId"),
                    "path": {
                        "type": "string",
                        "description": "The path to the list of component property objects in "
                        "the data model.",
                    },
                },
                "required": ["componentId", "path"],
                "additionalProperties": False,
            },
        ]
    },
    "DataBinding": {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "A JSON Pointer path to a value in the data model.",
            }
        },
        "required": ["path"],
        "additionalProperties": False,
    },
    "FunctionCall": {
        "type": "object",
        "description": "Invokes a named function on the client.",
        "properties": {
            "call": {"type": "string", "description": "The name of the function to call."},
            "args": {
                "type": "object",
                "description": "Arguments passed to the function.",
                "additionalProperties": _ref("DynamicValue"),
            },
        },
        "required": ["call"],
        "additionalProperties": False,
    },
    "DynamicValue": {
        "description": "A value that can be a literal, a path, or a function call returning any "
        "type.",
        "anyOf": [
            {"type": "string"},
            {"type": "number"},
            {"type": "boolean"},
            {"type": "array"},
            _ref("DataBinding"),
            _ref("FunctionCall"),
        ],
    },
    "DynamicString": {"anyOf": [{"type": "string"}, _ref("DataBinding"), _ref("FunctionCall")]},
    "DynamicNumber": {"anyOf": [{"type": "number"}, _ref("DataBinding"), _ref("FunctionCall")]},
    "DynamicBoolean": {"anyOf": [{"type": "boolean"}, _ref("DataBinding"), _ref("FunctionCall")]},
    "DynamicStringList": {
        "anyOf": [
            {"type": "array", "items": {"type": "string"}},
            _ref("DataBinding"),
            _ref("FunctionCall"),
        ]
    },
    "Action": {
        "description": "Defines an interaction handler that can either trigger a server-side "
        "event or execute a local client-side function.",
        "oneOf": [
            {
                "type": "object",
                "description": "Triggers a server-side event.",
                "properties": {
                    "event": {
                        "type": "object",
                        "properties": {
                            "name": {
                                "type": "string",
                                "description": "The name of the action to be dispatched to the "
                                "server.",
                            },
                            "context": {
                                "type": "object",
                                "description": "A JSON object containing the key-value pairs for "
                                "the action context. Values can be literals or paths.",
                                "additionalProperties": _ref("DynamicValue"),
                            },
                        },
                        "required": ["name"],
                        "additionalProperties": False,
                    }
                },
                "required": ["event"],
                "additionalProperties": False,
            },
            {
                "type": "object",
                "description": "Executes a local client-side function.",
                "properties": {"functionCall": _ref("FunctionCall")},
                "required": ["functionCall"],
                "additionalProperties": False,
            },
        ],
    },
}

A2UI_DEFAULT_GENERATION_GUIDELINES = """\
Generate A2UI v0.9 JSON.

## A2UI Protocol Instructions

A2UI (Agent to UI) is a protocol for rendering rich UI surfaces from agent responses.

CRITICAL: You MUST call the render_a2ui tool with ALL of these arguments:
- surfaceId: A unique ID for the surface (e.g. "product-comparison")
- components: REQUIRED — the A2UI component array. NEVER omit this. Only use
  components listed in the Available Components schema provided as context.
- data: OPTIONAL — a JSON object written to the root of the surface data model.
  Use for pre-filling form values or providing data for path-bound components.
- every component must have the "component" field specifying the component type.
  ONLY use component names from the Available Components schema — do NOT invent
  component names or use names not in the schema.

COMPONENT ID RULES:
- Exactly one component MUST have id="root". This is the surface's entry
  point — the renderer begins at "root" and walks the child/children tree
  from there. Every other component must be reachable from "root". If no
  component has id="root", the surface renders an empty loading placeholder
  and none of your components will be shown.
- Every component ID must be unique within the surface.
- A component MUST NOT reference itself as child/children. This causes a
  circular dependency error. For example, if a component has id="avatar",
  its child must be a DIFFERENT id (e.g. "avatar-img"), never "avatar".
- The child/children tree must be a DAG — no cycles allowed.

REPEATING CONTENT (TEMPLATES):
To repeat a component for each item in an array, use the structural children format:
  children: { componentId: "card-id", path: "/items" }
This tells the renderer to create one instance of "card-id" per item in the "/items" array.

PATH RULES FOR TEMPLATES:
Components inside a repeating template use RELATIVE paths (no leading slash).
The path is resolved relative to each array item automatically.
If a container has children: { componentId: "card", path: "/items" } and each item
has a key "name", use { "path": "name" } (NO leading slash — relative to item).
CRITICAL: Do NOT use "/name" (absolute) inside templates — use "name" (relative).
The container's path ("/items") uses a leading slash (absolute), but all
components INSIDE the template use paths WITHOUT leading slash.

COMPONENT VALUES — DEFAULT RULE:
Use inline literal values for ALL component properties. Pass strings, numbers,
arrays, and objects directly on the component. Do NOT use { "path": "..." }
objects unless the property's schema explicitly allows it (see exception below).
CRITICAL: USING { "path": "..." } ON A PROPERTY THAT DOES NOT DECLARE PATH
SUPPORT IN ITS SCHEMA WILL CAUSE A RUNTIME CRASH AND BREAK THE ENTIRE UI.
ALWAYS CHECK THE COMPONENT SCHEMA FIRST — IF THE PROPERTY ONLY ACCEPTS A
PLAIN TYPE, YOU MUST USE A LITERAL VALUE.
VERY IMPORTANT: THE APPLICATION WILL BREAK IF YOU DO NOT FOLLOW THIS RULE!

For example, a chart's "data" must always be an inline array:
  "data": [{"label": "Jan", "value": 100}, {"label": "Feb", "value": 200}]
A metric's "value" must always be an inline string:
  "value": "$1,200"

PATH BINDING EXCEPTION — SCHEMA-DRIVEN:
A few properties accept { "path": "/some/path" } as an alternative to a literal
value. You can identify these in the Available Components schema: the property
will list BOTH a literal type AND an object-with-path option. If a property only
shows a single type (string, number, array, etc.), it does NOT support path
binding — use a literal value only.

Path binding is typically used for editable form inputs so the client can write
user input back to the data model. When building forms:
- Bind input "value" to a data model path: "value": { "path": "/form/name" }
- Pre-fill via the "data" tool argument: "data": { "form": { "name": "Alice" } }
- Capture values on submit via button action context:
    "action": { "event": { "name": "submit", "context": { "name": { "path": "/form/name" } } } }

REPEATING CONTENT uses a structural children format (not the same as value binding):
  children: { componentId: "card-id", path: "/items" }
Components inside templates use RELATIVE paths (no leading slash): { "path": "name" }."""

A2UI_DEFAULT_DESIGN_GUIDELINES = """\
Create polished, visually appealing interfaces. ONLY use components listed in the
Available Components schema — do NOT use component names that are not in the schema.

Design principles:
- Create clear visual hierarchy within cards and layouts.
- Keep cards clean — avoid clutter. Whitespace is good.
- Use consistent surfaceIds (lowercase, hyphenated).
- NEVER use the same ID for a component and its child — this creates a
  circular dependency. E.g. if id="avatar", child must NOT be "avatar".
- For side-by-side comparisons, use a container with structural children
  (children: { componentId, path }) to repeat a card template per data item.
- Include images when relevant (logos, icons, product photos):
  - Prefer company logos via Google favicons: https://www.google.com/s2/favicons?domain=example.com&sz=128
  - Do NOT invent Unsplash photo-IDs — they will 404. Only use real, known URLs.
- For buttons: action MUST use this exact nested format:
    "action": { "event": { "name": "myAction", "context": { "key": "value" } } }
  The "event" key holds an OBJECT with "name" (required) and "context" (optional).
  Do NOT use a flat format like {"event": "name"} — "event" must be an object.
- For forms: check the component schema — if an input's "value" property
  supports path binding, use it for editable fields. The submit button's
  action context should reference the same paths to capture user input.

Use the SAME surfaceId as the main surface. Match action names to button action event names."""

_DYNAMIC_TYPES = {"string": "DynamicString", "number": "DynamicNumber", "boolean": "DynamicBoolean"}
_DYNAMIC_REFS = {
    "string": "DynamicString",
    "number": "DynamicNumber",
    "boolean": "DynamicBoolean",
    "string[]": "DynamicStringList",
    "unknown": "DynamicValue",
}


def _v09_text(text: str) -> str:
    """1.0 binding and call syntax in a description, written the v0.9 way."""
    return text.replace('"@path"', '"path"').replace('"@call"', '"call"')


def _v09_schema(value: Any) -> Any:
    """A copy of a schema, with its descriptions written the v0.9 way."""
    if isinstance(value, list):
        return [_v09_schema(item) for item in value]
    if not is_record(value):
        return value
    return {
        key: _v09_text(child)
        if key == "description" and isinstance(child, str)
        else _v09_schema(child)
        for key, child in value.items()
    }


def _dynamic_value(schema: Any) -> Json:
    """A prop as v0.9 states it: its literal schema, a `{ path }` or a `{ call }`.

    Only the prop itself is made dynamic, as in the v0.9 basic catalog.
    """
    if not is_record(schema):
        return _ref("DynamicValue")
    v09: Json = _v09_schema(schema)
    if child_ref_kind(schema):
        return v09
    literal = {key: value for key, value in v09.items() if key != "description"}
    description = v09.get("description")
    text = {"description": description} if isinstance(description, str) else {}
    if len(literal) == 1 and isinstance(literal.get("type"), str):
        dynamic = _DYNAMIC_TYPES.get(literal["type"])
        if dynamic:
            return {**_ref(dynamic), **text}
    items = literal.get("items")
    if (
        len(literal) == 2
        and literal.get("type") == "array"
        and is_record(items)
        and len(items) == 1
        and items.get("type") == "string"
    ):
        return {**_ref("DynamicStringList"), **text}
    return {**text, "anyOf": [literal, _ref("DataBinding"), _ref("FunctionCall")]}


def _dynamic_properties(schema: Json) -> Json:
    """An object schema with each of its properties made dynamic."""
    result: Json = _v09_schema(schema)
    if is_record(schema.get("properties")):
        result["properties"] = {
            key: _dynamic_value(value) for key, value in schema["properties"].items()
        }
    return result


def _rebase_refs(value: Any, base: str) -> Any:
    """Point the local refs (`#/...`) of a props schema to where it is embedded."""
    if isinstance(value, list):
        return [_rebase_refs(item, base) for item in value]
    if not is_record(value):
        return value
    result = {key: _rebase_refs(child, base) for key, child in value.items()}
    target = result.get("$ref")
    if target == "#":
        result["$ref"] = base
    elif isinstance(target, str) and target.startswith("#/"):
        result["$ref"] = base + target[1:]
    return result


def _component_schema(name: str, manifest: Json, renames: dict[str, str]) -> Json:
    """One component in the v0.9 inline catalog format, under its v0.9 prop names."""
    props = manifest["props"]
    properties = props.get("properties")
    fields: Json = {}
    for key, schema in (properties if is_record(properties) else {}).items():
        fields[key] = _dynamic_value(schema)
    for key, event in (manifest.get("events") or {}).items():
        fields[key] = {
            **_ref("Action"),
            **(
                {"description": _v09_text(event["description"])} if event.get("description") else {}
            ),
        }
    for key, kind in (manifest.get("slots") or {}).items():
        fields[key] = _ref("ComponentId" if kind == "single" else "ChildList")
    ordered: Json = {"component": {"const": name}}
    for key in [*(manifest.get("parameterOrder") or []), *fields]:
        if key in fields:
            ordered[renames.get(key, key)] = fields[key]
    required = props.get("required")
    body: Json = {
        "properties": ordered,
        "required": [
            "component",
            *(
                renames.get(key, key)
                for key in (required if isinstance(required, list) else [])
                if isinstance(key, str)
            ),
        ],
    }
    for key in ("$defs", "definitions"):
        if is_record(props.get(key)):
            body[key] = _v09_schema(props[key])
    segment = name.replace("~", "~0").replace("/", "~1")
    text = manifest.get("description")
    if text is None:
        text = props.get("description")
    return {
        **({"description": _v09_text(text)} if isinstance(text, str) else {}),
        "allOf": [_ref("ComponentCommon"), _rebase_refs(body, f"#/components/{segment}/allOf/1")],
    }


def _type_schema(type_: str) -> Json:
    trimmed = type_.strip()
    alternatives = [part.strip() for part in trimmed.split("|")]
    if len(alternatives) > 1:
        return {"anyOf": [_type_schema(part) for part in alternatives]}
    if trimmed in _DYNAMIC_REFS:
        return _ref(_DYNAMIC_REFS[trimmed])
    if trimmed.endswith("[]"):
        # The whole list can be bound or computed, like any other arg.
        return {
            "anyOf": [
                {"type": "array", "items": _type_schema(trimmed[:-2])},
                _ref("DataBinding"),
                _ref("FunctionCall"),
            ]
        }
    return _ref("DynamicValue")


def args_schema_from_signature(signature: str) -> Json:
    """The JSON Schema of the args of a built-in function, from its short signature."""
    body = re.sub(r"\}$", "", re.sub(r"^\{", "", signature.strip()))
    properties: Json = {}
    required: list[str] = []
    additional: Json | bool = False
    for part in body.split(";"):
        entry = part.strip()
        if not entry:
            continue
        index = re.match(r"^\[\w+: string\]:\s*(.+)$", entry, re.ASCII)
        if index:
            additional = _type_schema(index.group(1))
            continue
        named = re.match(r"^(\w+)(\?)?:\s*(.+)$", entry, re.ASCII)
        if not named:
            continue
        properties[named.group(1)] = _type_schema(named.group(3))
        if not named.group(2):
            required.append(named.group(1))
    return {
        "type": "object",
        "properties": properties,
        **({"required": required} if required else {}),
        "additionalProperties": additional,
    }


def _function_schema(name: str, description: Any, return_type: Any, parameters: Json) -> Json:
    return {
        "name": name,
        **({"description": _v09_text(description)} if description else {}),
        # v0.9 has no `validationResult`: its checks are boolean function calls.
        "returnType": "boolean"
        if return_type == "validationResult"
        else (return_type if return_type is not None else "any"),
        "parameters": parameters,
    }


def _catalog_functions(functions: dict[str, Json]) -> list[Json]:
    """The basic functions, then the app functions the renderer may call."""
    result = [
        _function_schema(
            name, info.description, info.return_type, args_schema_from_signature(info.parameters)
        )
        for name, info in A2UI_BASIC_FUNCTIONS.items()
        if name not in functions
    ]
    for name, fn in functions.items():
        if function_callers(fn)[0]:
            result.append(
                _function_schema(
                    name,
                    fn.get("description"),
                    fn.get("returnType"),
                    _dynamic_properties(fn["parameters"]),
                )
            )
    return result


def _capabilities(catalog_id: str, names: list[str] | None) -> str:
    """The catalog id, then the components beyond the v0.9 basic catalog, by name."""
    lines = ["Available A2UI catalog:"]
    if names is None:
        lines.append(f"- {catalog_id}")
        return "\n".join(lines)
    extra = [name for name in names if name not in _V09_BASIC_COMPONENTS]
    is_superset = all(name in names for name in _V09_BASIC_COMPONENTS)
    if catalog_id == _V09_BASIC_CATALOG_ID and is_superset and not extra:
        lines.append(f"- {catalog_id} (basic catalog)")
        return "\n".join(lines)
    lines.append(f"- {catalog_id}")
    if is_superset:
        lines.append("  Extends the basic catalog with all standard components plus:")
    else:
        lines.append("  Custom catalog (does NOT include all basic components).")
        lines.append("  Custom components:")
    lines.extend(f"  - {name}" for name in extra)
    return "\n".join(lines)


def build_v09_catalog_context(input: Json) -> tuple[str, list[Json]] | None:
    """The A2UI v0.9 catalog context of a run, from the client's generative UI envelope.

    The entries are the ones the v0.9 client sent: capabilities, the component schema in
    the v0.9 inline catalog format, and the v0.9 generation and design guidelines. The
    components are the 18 basic ones of the standard catalog plus the UI's own components.
    The catalog id is the v0.9 basic catalog id when the UI includes the standard catalog.
    Returns (catalog id, context entries), or None when the run has no envelope.
    """
    envelope = read_envelope(input.get("forwardedProps"))
    if envelope is None:
        return None
    manifest = envelope_to_manifest(envelope)
    extends_standard = STANDARD_CATALOG_ID in (manifest.catalog_ids or [manifest.catalog_id])
    catalog_id = _V09_BASIC_CATALOG_ID if extends_standard else manifest.catalog_id
    if not manifest.has_components:
        return catalog_id, [
            {"description": _CAPABILITIES_DESCRIPTION, "value": _capabilities(catalog_id, None)}
        ]
    components: Json = {}
    for name, component in manifest.components.items():
        is_standard = extends_standard and name in _STANDARD_COMPONENTS
        # Of the standard components, a v0.9 agent knows the basic ones only.
        if is_standard and name not in _V09_BASIC_COMPONENTS:
            continue
        renames = _V10_TO_V09_PROP_NAMES.get(name, {}) if is_standard else {}
        components[name] = _component_schema(name, component, renames)
    schema = {
        "catalogId": catalog_id,
        "components": components,
        "functions": _catalog_functions(manifest.functions),
        "common_types.json": {"$defs": _V09_COMMON_TYPES},
    }
    return catalog_id, [
        {
            "description": _CAPABILITIES_DESCRIPTION,
            "value": _capabilities(catalog_id, list(components)),
        },
        {"description": SCHEMA_DESCRIPTION, "value": compact_json(schema)},
        {
            "description": _GENERATION_GUIDELINES_DESCRIPTION,
            "value": A2UI_DEFAULT_GENERATION_GUIDELINES,
        },
        {"description": _DESIGN_GUIDELINES_DESCRIPTION, "value": A2UI_DEFAULT_DESIGN_GUIDELINES},
    ]


# ---------------------------------------------------------------------------
# The bridge (`a2ui-v09-middleware.ts`)


def prepare_v09_agent_input(input: Json, agent_version: A2UIVersion) -> Json:
    """The input of the agent side of a run; never mutates `input`.

    A click on a surface of v0.9 origin becomes the v0.9 action. A 0.9 agent also gets the
    v0.9 catalog context; an entry with the same description is replaced. The runtime stores
    the client's input, so the thread keeps the click message.
    """
    agent_input = downgrade_v09_action(input, agent_version)
    if agent_version != "0.9":
        return agent_input
    catalog = build_v09_catalog_context(agent_input)
    if catalog is None:
        return agent_input
    entries = catalog[1]
    descriptions = {entry["description"] for entry in entries}
    context = [
        entry
        for entry in agent_input.get("context") or []
        if not (is_record(entry) and entry.get("description") in descriptions)
    ]
    return {**agent_input, "context": context + entries}
