"""Native A2UI v0.9 middleware, aligned with AG-UI middleware 0.0.10."""

import copy
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from .models import Json

SCHEMA_DESCRIPTION = "A2UI Component Schema — available components for generating UI surfaces. Use these component names and properties when creating A2UI operations."
BASIC_CATALOG = "https://a2ui.org/specification/v0_9/basic_catalog.json"
_DECODER = json.JSONDecoder()
_OPS = ("createSurface", "updateComponents", "updateDataModel", "deleteSurface")


@dataclass(frozen=True)
class A2UIConfig:
    """Configure per-agent A2UI context, tool injection and recovery presentation."""

    enabled: bool = True
    agents: tuple[str, ...] | None = None
    schema: Json | list[Json] | None = None
    inject_tool: bool | str = False
    tool_names: tuple[str, ...] = ("render_a2ui",)
    default_catalog_id: str | None = None
    max_attempts: int = 3
    show_progress_tokens: bool = True
    debug_exposure: str | None = None
    max_argument_bytes: int = 2 * 1024 * 1024

    def __post_init__(self) -> None:
        """Validate public configuration before a run starts."""
        if not isinstance(self.inject_tool, (bool, str)) or self.inject_tool == "":
            raise ValueError("inject_tool must be a bool or nonempty tool name")
        if self.max_attempts < 1 or self.max_argument_bytes < 1:
            raise ValueError("A2UI limits must be positive")
        if self.debug_exposure not in (None, "hidden", "collapsed", "verbose"):
            raise ValueError("Invalid A2UI debug exposure")

    def applies(self, agent_id: str) -> bool:
        """Return whether A2UI is enabled for this configured agent."""
        return self.enabled and (self.agents is None or agent_id in self.agents)


def _references(value: Any, path: str) -> list[tuple[str, str]]:
    """Extract references from a string, template or reference list."""
    if isinstance(value, str):
        return [(path, value)]
    if isinstance(value, dict) and isinstance(value.get("componentId"), str):
        return [(path, value["componentId"])]
    if isinstance(value, list):
        return [
            edge
            for index, item in enumerate(value)
            for edge in _references(item, f"{path}[{index}]")
        ]
    return []


def _edges(component: Json, schema: Json) -> list[tuple[str, str]]:
    """Read implicit children plus catalog-marked component references."""
    result = _references(component.get("child"), "child") + _references(
        component.get("children"), "children"
    )
    for field, prop in schema.get("properties", {}).items():
        if field in ("child", "children") or not isinstance(prop, dict):
            continue
        if prop.get("format") in ("componentRef", "componentRefList"):
            result.extend(_references(component.get(field), field))
        elif prop.get("type") == "array" and isinstance(prop.get("items"), dict):
            values = component.get(field)
            if not isinstance(values, list):
                continue
            for index, item in enumerate(values):
                if not isinstance(item, dict):
                    continue
                for name, sub in prop["items"].get("properties", {}).items():
                    if isinstance(sub, dict) and sub.get("format") in (
                        "componentRef",
                        "componentRefList",
                    ):
                        result.extend(_references(item.get(name), f"{field}[{index}].{name}"))
    return result


def validate_components(components: Any, catalog: Json | None = None) -> list[Json]:
    """Validate the atomic component tree before paint; bindings remain deferred."""
    errors: list[Json] = []

    def add(code: str, path: str, message: str) -> None:
        errors.append({"code": code, "path": path, "message": message})

    if not isinstance(components, list) or not components:
        add("empty_components", "components", "A2UI components must be a non-empty array")
        return errors
    ids: set[str] = set()
    adjacency: dict[str, list[str]] = {}
    for component in components:
        identifier = component.get("id") if isinstance(component, dict) else None
        if isinstance(identifier, str):
            if identifier in ids:
                add(
                    "duplicate_id",
                    f"components[id={identifier}]",
                    f"Duplicate component id '{identifier}'",
                )
            ids.add(identifier)
    for index, component in enumerate(components):
        component = component if isinstance(component, dict) else {}
        identifier, kind = component.get("id"), component.get("component")
        if not isinstance(identifier, str) or not identifier:
            add(
                "missing_id",
                f"components[{index}].id",
                f"Component at index {index} is missing a string 'id'",
            )
        if not isinstance(kind, str) or not kind:
            add(
                "missing_component_type",
                f"components[{index}].component",
                f"Component at index {index} is missing a string 'component' type",
            )
        schema = (
            (catalog or {}).get("components", {}).get(kind, {}) if isinstance(kind, str) else {}
        )
        if catalog and isinstance(kind, str):
            if kind not in catalog.get("components", {}):
                add(
                    "unknown_component",
                    f"components[{index}].component",
                    f"Component type '{kind}' is not in the catalog",
                )
            else:
                for prop in schema.get("required", []):
                    if prop not in component:
                        add(
                            "missing_required_prop",
                            f"components[{index}].{prop}",
                            f"Component '{kind}' (index {index}) is missing required prop '{prop}'",
                        )
        edges = _edges(component, schema)
        for path, ref in edges:
            if ref not in ids:
                add(
                    "unresolved_child",
                    f"components[{index}].{path}",
                    f"Child reference '{ref}' does not match any component id",
                )
        if isinstance(identifier, str):
            adjacency[identifier] = [ref for _, ref in edges]
    colors: dict[str, int] = {}
    cycles: set[tuple[str, ...]] = set()
    for root in adjacency:
        if colors.get(root):
            continue
        stack = [(root, 0)]
        chain = [root]
        colors[root] = 1
        while stack:
            node, index = stack[-1]
            neighbors = adjacency.get(node, [])
            if index >= len(neighbors):
                colors[node] = 2
                stack.pop()
                chain.pop()
                continue
            stack[-1] = (node, index + 1)
            child = neighbors[index]
            if not colors.get(child):
                colors[child] = 1
                stack.append((child, 0))
                chain.append(child)
            elif colors[child] == 1:
                cycle = chain[chain.index(child) :]
                smallest = cycle.index(min(cycle))
                canonical = tuple(cycle[smallest:] + cycle[:smallest])
                if canonical not in cycles:
                    cycles.add(canonical)
                    add(
                        "child_cycle",
                        f"components[id={canonical[0]}]",
                        "Child reference cycle detected: "
                        + " -> ".join([*canonical, canonical[0]]),
                    )
    if "root" not in ids:
        add("no_root", "components", "No component has id 'root'")
    return errors


def _field(raw: str, name: str) -> str | None:
    """Find a root property without mistaking quoted content for a field name."""
    raw = raw.lstrip()
    if not raw.startswith("{"):
        return None
    position = 1
    try:
        while position < len(raw):
            position += len(raw[position:]) - len(raw[position:].lstrip())
            key, end = _DECODER.raw_decode(raw, position)
            position = end
            position += len(raw[position:]) - len(raw[position:].lstrip())
            if raw[position] != ":":
                return None
            position += 1
            position += len(raw[position:]) - len(raw[position:].lstrip())
            if key == name:
                return raw[position:]
            _, position = _DECODER.raw_decode(raw, position)
            position += len(raw[position:]) - len(raw[position:].lstrip())
            if raw[position] != ",":
                return None
            position += 1
    except (ValueError, IndexError):
        return None
    return None


def _value(raw: str, field: str) -> Any:
    """Read a complete root value from otherwise partial JSON."""
    fragment = _field(raw, field)
    if fragment is None:
        return None
    try:
        return _DECODER.raw_decode(fragment)[0]
    except ValueError:
        return None


def _array(fragment: str | None) -> tuple[list[Any], bool]:
    """Return only complete array entries, plus the array closure status."""
    if fragment is None or not fragment.startswith("["):
        return [], False
    items: list[Any] = []
    position = 1
    try:
        while position < len(fragment):
            position += len(fragment[position:]) - len(fragment[position:].lstrip())
            if fragment[position] == "]":
                return items, True
            item, position = _DECODER.raw_decode(fragment, position)
            items.append(item)
            position += len(fragment[position:]) - len(fragment[position:].lstrip())
            if fragment[position] == "]":
                return items, True
            if fragment[position] != ",":
                return items, False
            position += 1
    except (ValueError, IndexError):
        pass
    return items, False


class A2UIMiddleware:
    """Create isolated stream state per run; model retry decisions stay with agents."""

    def __init__(self, config: A2UIConfig) -> None:
        self.config = config
        self.names = set(config.tool_names)
        self.tool_name = (
            config.inject_tool if isinstance(config.inject_tool, str) else "render_a2ui"
        )
        if config.inject_tool:
            self.names.add(self.tool_name)

    def prepare(self, input: Json) -> Json:
        """Inject server context, optional tool schema, and synthetic action history."""
        result = copy.deepcopy(input)
        context = result.setdefault("context", [])
        forwarded = result.setdefault("forwardedProps", {})
        action = forwarded.get("a2uiAction", {}).get("userAction")
        if isinstance(action, dict):
            call_id = str(uuid4())
            text = f'User performed action "{action.get("name", "unknown_action")}" on surface "{action.get("surfaceId", "unknown_surface")}"'
            if action.get("sourceComponentId"):
                text += f" (component: {action['sourceComponentId']})"
            text += ". Context: " + json.dumps(action.get("context", {}), separators=(",", ":"))
            result.setdefault("messages", []).extend(
                [
                    {
                        "id": str(uuid4()),
                        "role": "assistant",
                        "content": "",
                        "toolCalls": [
                            {
                                "id": call_id,
                                "type": "function",
                                "function": {
                                    "name": "log_a2ui_event",
                                    "arguments": json.dumps(action),
                                },
                            }
                        ],
                    },
                    {"id": str(uuid4()), "role": "tool", "toolCallId": call_id, "content": text},
                ]
            )
        if self.config.schema:
            context[:] = [
                entry for entry in context if entry.get("description") != SCHEMA_DESCRIPTION
            ]
            context.append(
                {"description": SCHEMA_DESCRIPTION, "value": json.dumps(self.config.schema)}
            )
        if self.config.inject_tool:
            result["tools"] = [
                tool for tool in result.get("tools", []) if tool.get("name") != self.tool_name
            ]
            result["tools"].append(
                {
                    "name": self.tool_name,
                    "description": "Render a dynamic A2UI v0.9 surface with structured parameters. Follow the A2UI render tool usage guide provided in context.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "surfaceId": {
                                "type": "string",
                                "description": "Unique surface identifier.",
                            },
                            "components": {"type": "array", "items": {"type": "object"}},
                            "data": {"type": "object"},
                        },
                        "required": ["surfaceId", "components"],
                    },
                }
            )
            forwarded["injectA2UITool"] = self.config.inject_tool
            description = (
                f"A2UI render tool usage guide — how to call {self.tool_name} with valid arguments."
            )
            context[:] = [entry for entry in context if entry.get("description") != description]
            context.append(
                {
                    "description": description,
                    "value": f'Call {self.tool_name} with surfaceId and a nonempty components array. Use flat v0.9 components with unique id and component fields. Include id root. Reference children by ID. Only use catalog component names and required properties. Data bindings use {{"path":"/key"}}. Repeated children use {{"componentId":"item","path":"/items"}}. Supply data for bindings. The host owns catalogId. Actions use an event object with name and context. Do not invent image URLs.',
                }
            )
        return result

    def _activity(self, key: str, content: Json) -> Json:
        """Keep building/retry/failure/paint states on one replaceable message ID."""
        if "status" in content and self.config.debug_exposure:
            content = {**content, "debugExposure": self.config.debug_exposure}
        return {
            "type": "ACTIVITY_SNAPSHOT",
            "messageId": "a2ui-surface-" + key,
            "activityType": "a2ui-surface",
            "content": content,
            "replace": True,
        }

    async def transform(self, source: AsyncIterator[Json], original: Json) -> AsyncIterator[Json]:
        """Emit validated atomic components and cumulative progressive data before persistence."""
        calls: dict[str, Json] = {}
        resolved = {
            message.get("toolCallId")
            for message in original.get("messages", [])
            if message.get("role") == "tool"
        }
        outer: str | None = None
        painted: set[str] = set()
        retries: set[str] = set()
        attempts: dict[str, int] = {}
        frontend_catalog = None
        for entry in original.get("context", []):
            if entry.get("description") == SCHEMA_DESCRIPTION:
                try:
                    frontend_catalog = json.loads(entry["value"]).get("catalogId")
                except (ValueError, AttributeError, KeyError):
                    pass
        catalog = (
            self.config.schema
            if isinstance(self.config.schema, dict) and self.config.schema.get("components")
            else None
        )
        async for event in source:
            kind, call_id = event.get("type"), event.get("toolCallId", "")
            if kind == "TOOL_CALL_START":
                if event.get("toolCallName") in self.names:
                    key = outer or call_id
                    attempts[key] = attempts.get(key, 0) + 1
                    calls[call_id] = {
                        "args": "",
                        "key": key,
                        "components": None,
                        "rejected": False,
                        "items": 0,
                        "complete": False,
                        "tokens": 0,
                    }
                    if key not in retries:
                        yield self._activity(key, {"status": "building"})
                elif event.get("toolCallName") != "log_a2ui_event":
                    outer = call_id
            elif kind == "TOOL_CALL_ARGS" and call_id in calls:
                state = calls[call_id]
                state["args"] += event.get("delta", "")
                if len(state["args"].encode()) > self.config.max_argument_bytes:
                    raise ValueError("A2UI arguments exceed configured limit")
                raw, key = state["args"], state["key"]
                tokens = int(len(raw) / 4 + 0.5)
                if (
                    self.config.show_progress_tokens
                    and not state["components"]
                    and key not in retries
                    and tokens - state["tokens"] >= 20
                ):
                    state["tokens"] = tokens
                    yield self._activity(key, {"status": "building", "progressTokens": tokens})
                surface = _value(raw, "surfaceId") or call_id
                streamed_catalog = _value(raw, "catalogId")
                catalog_id = (
                    self.config.default_catalog_id
                    or frontend_catalog
                    or (
                        streamed_catalog
                        if streamed_catalog and streamed_catalog != "basic"
                        else BASIC_CATALOG
                    )
                )
                components_advanced = False
                if state["components"] is None and not state["rejected"]:
                    components, closed = _array(_field(raw, "components"))
                    if closed:
                        errors = validate_components(components, catalog)
                        if errors:
                            state["rejected"] = True
                            retries.add(key)
                            yield self._activity(
                                key,
                                {
                                    "status": "retrying",
                                    "attempt": min(attempts[key] + 1, self.config.max_attempts),
                                    "maxAttempts": self.config.max_attempts,
                                    "errors": errors,
                                },
                            )
                        else:
                            state["components"] = components
                            components_advanced = True
                            state["surface"] = surface
                            state["catalog"] = catalog_id
                if state["components"]:
                    surface = state["surface"]
                    catalog_id = state["catalog"]
                    data_key = next(
                        (
                            component["children"]["path"].removeprefix("/")
                            for component in state["components"]
                            if isinstance(component.get("children"), dict)
                            and isinstance(component["children"].get("path"), str)
                        ),
                        "items",
                    )
                    data_fragment = _field(raw, "data")
                    items, _ = _array(_field(data_fragment, data_key) if data_fragment else None)
                    ops = [
                        {
                            "version": "v0.9",
                            "createSurface": {"surfaceId": surface, "catalogId": catalog_id},
                        },
                        {
                            "version": "v0.9",
                            "updateComponents": {
                                "surfaceId": surface,
                                "components": state["components"],
                            },
                        },
                    ]
                    if components_advanced or (
                        len(items) > state["items"] and not state["complete"]
                    ):
                        state["items"] = len(items)
                        progressive = ops + (
                            [
                                {
                                    "version": "v0.9",
                                    "updateDataModel": {
                                        "surfaceId": surface,
                                        "path": "/",
                                        "value": {data_key: items},
                                    },
                                }
                            ]
                            if items
                            else []
                        )
                        yield self._activity(key, {"a2ui_operations": progressive})
                        painted.add(surface)
                        retries.discard(key)
                    data = _value(raw, "data")
                    if isinstance(data, dict) and not state["complete"]:
                        state["complete"] = True
                        yield self._activity(
                            key,
                            {
                                "a2ui_operations": ops
                                + [
                                    {
                                        "version": "v0.9",
                                        "updateDataModel": {
                                            "surfaceId": surface,
                                            "path": "/",
                                            "value": data,
                                        },
                                    }
                                ]
                            },
                        )
            if kind == "RUN_FINISHED":
                for pending_id in calls.keys() - resolved:
                    yield {
                        "type": "TOOL_CALL_RESULT",
                        "messageId": str(uuid4()),
                        "toolCallId": pending_id,
                        "content": json.dumps({"status": "rendered"}),
                    }
                    resolved.add(pending_id)
            yield event
            if kind == "TOOL_CALL_RESULT":
                resolved.add(call_id)
                try:
                    content = json.loads(event.get("content", ""))
                except (ValueError, TypeError):
                    content = None
                if isinstance(content, dict):
                    operations = content.get("a2ui_operations")
                    if isinstance(operations, list):
                        groups: dict[str, list[Json]] = {}
                        for operation in operations:
                            if not isinstance(operation, dict):
                                continue
                            op_name = next(
                                (name for name in _OPS if isinstance(operation.get(name), dict)),
                                None,
                            )
                            if op_name:
                                surface = operation[op_name].get("surfaceId", "default")
                                if surface not in painted:
                                    groups.setdefault(surface, []).append(operation)
                        for surface, group in groups.items():
                            key = outer or call_id
                            if len(groups) > 1:
                                key = surface + "-" + key
                            yield self._activity(key, {"a2ui_operations": group})
                    elif content.get("code") == "a2ui_recovery_exhausted":
                        history = content.get("attempts", [])
                        yield self._activity(
                            outer or call_id,
                            {
                                "status": "failed",
                                "error": content.get("error", "A2UI generation failed"),
                                "attempts": history,
                                "maxAttempts": len(history) or self.config.max_attempts,
                            },
                        )
                if call_id == outer:
                    outer = None
