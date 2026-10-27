"""Repair A2UI fence lines as the reply streams.

With CopilotKit's markdown transport the model writes A2UI operations as one
JSON object per line inside ```a2ui fences, and the client drops any line that
does not parse. On long lines Gemini sometimes misses a closing brace, which
throws away every component on that line. This pass sits on the AG-UI text
stream: prose passes through untouched, and fence lines are checked and, when
they do not parse, repaired with json-repair before they reach the client.

Gemini often writes a whole component tree on one updateComponents line. The
client renders the finished components of a half-written line, so such a
line is not held until it ends: its header goes out as soon as it is known,
then each component as soon as its object closes, repaired on its own, and
the view builds up while the model writes. Other operations are held until
their line is complete.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from ag_ui.core import BaseEvent, TextMessageContentEvent, TextMessageEndEvent
from json_repair import repair_json

logger = logging.getLogger(__name__)

COMPONENTS_OPEN = re.compile(r'"components"\s*:\s*\[')

FENCE_OPEN = "```a2ui"
FENCE_CLOSE = "```"


CALL_KEYS = {"@call", "args"}


def nest_call_args(value: Any) -> bool:
    """Moves loose keys of a function call into its args, in place.

    A2UI writes a call as {"@call": name, "args": {...}}; models often flatten
    it to {"@call": name, "expression": ..., "x": ...}. Returns True when
    anything moved.
    """
    changed = False
    if isinstance(value, dict):
        if "@call" in value:
            loose = [key for key in value if key not in CALL_KEYS]
            if loose:
                args = value.get("args") if isinstance(value.get("args"), dict) else {}
                for key in loose:
                    args.setdefault(key, value.pop(key))
                value["args"] = args
                changed = True
        for child in list(value.values()):
            changed = nest_call_args(child) or changed
    elif isinstance(value, list):
        for child in value:
            changed = nest_call_args(child) or changed
    return changed


OPERATION_KEYS = ("createSurface", "updateComponents")
WRAPPER_KEYS = ("props", "events")


def flatten_components(operation: Any) -> bool:
    """Puts a component's props and events where A2UI v1.0 reads them.

    Models often write {"component": "Form", "events": {"onSubmit": ...}},
    nest props under "props", name the component "type", or give a submit
    Button an onClick that a submit button never sends. Returns True when
    anything changed.
    """
    changed = False
    if not isinstance(operation, dict):
        return False
    for kind in OPERATION_KEYS:
        payload = operation.get(kind)
        components = payload.get("components") if isinstance(payload, dict) else None
        if not isinstance(components, list):
            continue
        # A salvaged line can hold stray strings; the renderer rejects the
        # whole operation for one, so keep only real components.
        kept = [node for node in components if isinstance(node, dict)]
        if len(kept) != len(components):
            payload["components"] = kept
            changed = True
        for node in kept:
            if "component" not in node and isinstance(node.get("type"), str):
                node["component"] = node.pop("type")
                changed = True
            for wrapper in WRAPPER_KEYS:
                inner = node.get(wrapper)
                if isinstance(inner, dict):
                    del node[wrapper]
                    for key, value in inner.items():
                        node.setdefault(key, value)
                    changed = True
            changed = slot_table_cells(node) or changed
            changed = theme_chart_colors(node) or changed
            changed = unbox_root_card(node) or changed
            # A submit Button defers to its Form's onSubmit and skips its own
            # onClick; when the model put the event on the Button, keep it.
            if (
                node.get("component") == "Button"
                and node.get("submit")
                and "onClick" in node
            ):
                del node["submit"]
                changed = True
    return changed


def unbox_root_card(node: dict) -> bool:
    """The app already frames every view as a sheet, so a Card at the root
    becomes a "section" (a Card that draws no box) instead of a box in a box."""
    if node.get("id") != "root" or node.get("component") != "Card":
        return False
    if node.get("variant") == "section":
        return False
    node["variant"] = "section"
    return True


def slot_table_cells(node: dict) -> bool:
    """A Table shows a {"componentId"} cell only when the id is also in its
    cellComponents slot; add the ids the rows and columns name."""
    if node.get("component") != "Table":
        return False
    rows = node.get("rows") if isinstance(node.get("rows"), list) else []
    columns = node.get("columns") if isinstance(node.get("columns"), list) else []
    cells = [cell for row in rows if isinstance(row, list) for cell in row] + columns
    ids = [
        cell["componentId"]
        for cell in cells
        if isinstance(cell, dict) and isinstance(cell.get("componentId"), str)
    ]
    slot = node.get("cellComponents")
    if not ids or not (slot is None or isinstance(slot, list)):
        return False
    missing = [i for i in dict.fromkeys(ids) if i not in (slot or [])]
    if missing:
        node["cellComponents"] = [*(slot or []), *missing]
    return bool(missing)


TEXT_COLOR_TOKENS = {
    "default",
    "prose",
    "primary",
    "emphasis",
    "secondary",
    "tertiary",
    "success",
    "info",
    "warning",
    "caution",
    "danger",
    "discovery",
}


def theme_chart_colors(node: dict) -> bool:
    """Drops raw CSS colors from chart series so the app's palette applies;
    theme tokens such as "info" stay."""
    if node.get("component") != "Chart" or not isinstance(node.get("series"), list):
        return False
    changed = False
    for entry in node["series"]:
        color = entry.get("color") if isinstance(entry, dict) else None
        if isinstance(color, str) and color not in TEXT_COLOR_TOKENS:
            del entry["color"]
            changed = True
    return changed


def normalize(value: Any) -> bool:
    return flatten_components(value) | nest_call_args(value)


def repair_line(line: str) -> str:
    stripped = line.strip()
    if not stripped or stripped.startswith(FENCE_CLOSE):
        return line
    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError:
        repaired = repair_json(stripped, ensure_ascii=False, return_objects=True)
        if not isinstance(repaired, dict) or not repaired:
            return line
        logger.info("a2ui fence: repaired a line of %d chars", len(stripped))
        normalize(repaired)
        return json.dumps(repaired, ensure_ascii=False)
    if normalize(parsed):
        logger.info("a2ui fence: normalized component shape")
        return json.dumps(parsed, ensure_ascii=False)
    return line


def _object_end(text: str, start: int) -> int:
    """The index after the object that opens at text[start], or -1 if it has
    not closed yet."""
    depth = 0
    in_string = escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
        elif char == '"':
            in_string = True
        elif char in "{[":
            depth += 1
        elif char in "}]":
            depth -= 1
            if depth == 0:
                return index + 1
    return -1


def _stream_header(line: str) -> tuple[str, int] | None:
    """For a line that is writing a components list, the canonical text up to
    and including the list's "[", and where the first component starts."""
    match = COMPONENTS_OPEN.search(line)
    if not match:
        return None
    head = line[: match.start()]
    kind = next((k for k in OPERATION_KEYS if f'"{k}"' in head), None)
    if kind is None or '"surfaceId"' not in head:
        return None
    parsed = repair_json(
        line[: match.end()] + "]}}", ensure_ascii=False, return_objects=True
    )
    payload = parsed.get(kind) if isinstance(parsed, dict) else None
    if not isinstance(payload, dict) or not isinstance(payload.get("surfaceId"), str):
        return None
    payload = {key: value for key, value in payload.items() if key != "components"}
    payload["components"] = []
    text = json.dumps(
        {"version": parsed.get("version", "v1.0"), kind: payload}, ensure_ascii=False
    )
    return text[: text.rindex("[]") + 1], match.end()


def _repaired_components(text: str) -> list[dict]:
    """One component's JSON, parsed (or salvaged) and normalized; a wrapper
    the model nested may come back as more than one component."""
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        value = repair_json(text, ensure_ascii=False, return_objects=True)
    items = value if isinstance(value, list) else [value]
    operation = {"updateComponents": {"components": items}}
    normalize(operation)
    return operation["updateComponents"]["components"]


class _StreamedLine:
    """Progress through one fence line whose components stream out."""

    def __init__(self, position: int) -> None:
        self.position = position
        self.count = 0
        self.closed = False

    def take(self, line: str, final: bool) -> str:
        """The components that completed since the last call, as text."""
        out: list[str] = []
        while not self.closed:
            rest = line[self.position :]
            skipped = len(rest) - len(rest.lstrip(" \t\r\n,"))
            start = self.position + skipped
            if start >= len(line):
                break
            if line[start] == "]":
                self.closed = True
                break
            if line[start] != "{":
                # Not a component: salvage what is left once the line ends.
                if final:
                    out.extend(self._salvage(line[start:]))
                    self.closed = True
                break
            end = _object_end(line, start)
            if end == -1:
                if final:
                    out.extend(self._salvage(line[start:]))
                    self.closed = True
                break
            out.extend(self._emit(_repaired_components(line[start:end])))
            self.position = end
        return "".join(out)

    def _salvage(self, text: str) -> list[str]:
        salvaged = repair_json("[" + text, ensure_ascii=False, return_objects=True)
        if not isinstance(salvaged, list):
            return []
        components = [
            component
            for item in salvaged
            if isinstance(item, dict)
            for component in _repaired_components(json.dumps(item))
        ]
        return self._emit(components)

    def _emit(self, components: list[dict]) -> list[str]:
        out = []
        for component in components:
            if not isinstance(component, dict):
                continue
            out.append(
                ("," if self.count else "") + json.dumps(component, ensure_ascii=False)
            )
            self.count += 1
        return out


class FenceRepairer:
    """Rewrites TEXT_MESSAGE_CONTENT deltas so every fence line parses."""

    def __init__(self) -> None:
        # Per message: the text not yet emitted, and whether it is inside a fence.
        self._pending: dict[str, str] = {}
        self._in_fence: dict[str, bool] = {}
        self._templates: dict[str, TextMessageContentEvent] = {}
        # Per message: the fence line whose components are streaming out.
        self._streaming: dict[str, _StreamedLine] = {}

    def _emit(self, message_id: str, text: str) -> list[BaseEvent]:
        if not text:
            return []
        template = self._templates[message_id]
        return [template.model_copy(update={"delta": text})]

    def _stream(self, message_id: str, line: str, final: bool) -> str:
        """Streams the components of an unfinished fence line. Returns what
        can go out now ("" until the line shows a components list)."""
        streamed = self._streaming.get(message_id)
        text = ""
        if streamed is None:
            header = _stream_header(line)
            if header is None:
                return ""
            text, position = header
            streamed = self._streaming[message_id] = _StreamedLine(position)
        text += streamed.take(line, final)
        if final:
            text += "]}}"
            del self._streaming[message_id]
        return text

    def _drain(self, message_id: str, final: bool) -> str:
        """Returns the text that can go out now; keeps an unfinished fence line
        back unless its components can stream."""
        buffer = self._pending.get(message_id, "")
        out: list[str] = []
        while buffer:
            in_fence = self._in_fence.get(message_id, False)
            newline = buffer.find("\n")
            if newline == -1:
                if in_fence:
                    streamed = self._stream(message_id, buffer, final)
                    if final and not streamed:
                        streamed = repair_line(buffer)
                    out.append(streamed)
                    if final:
                        buffer = ""
                elif final or not buffer.lstrip().startswith("`"):
                    # Prose with no fence marker in sight streams straight out.
                    out.append(buffer)
                    buffer = ""
                break
            line, buffer = buffer[: newline + 1], buffer[newline + 1 :]
            stripped = line.strip()
            if not in_fence and stripped.startswith(FENCE_OPEN):
                self._in_fence[message_id] = True
                out.append(line)
            elif in_fence and message_id in self._streaming:
                out.append(
                    self._stream(message_id, line.rstrip("\n"), final=True) + "\n"
                )
            elif in_fence and stripped.startswith(FENCE_CLOSE):
                self._in_fence[message_id] = False
                out.append(line)
            elif in_fence:
                streamed = self._stream(message_id, line.rstrip("\n"), final=True)
                out.append((streamed or repair_line(line.rstrip("\n"))) + "\n")
            else:
                out.append(line)
        self._pending[message_id] = buffer
        return "".join(out)

    def feed(self, event: BaseEvent) -> list[BaseEvent]:
        if isinstance(event, TextMessageContentEvent):
            message_id = event.message_id
            self._templates.setdefault(message_id, event)
            self._pending[message_id] = self._pending.get(message_id, "") + event.delta
            return self._emit(message_id, self._drain(message_id, final=False))
        if isinstance(event, TextMessageEndEvent) and event.message_id in self._pending:
            message_id = event.message_id
            tail = self._drain(message_id, final=True)
            events = (
                self._emit(message_id, tail) if message_id in self._templates else []
            )
            for store in (
                self._pending,
                self._in_fence,
                self._templates,
                self._streaming,
            ):
                store.pop(message_id, None)
            return [*events, event]
        return [event]
