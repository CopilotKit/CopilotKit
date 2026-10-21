"""Demo-only Express boundary; the CopilotKit client still receives A2UI JSON.

Like travel-a2ui's ExpressStream, recompile valid prefixes with the SDK while
text arrives. This adapter uses the current SDK and the frontend's own catalog;
it does not bring the travel agent's prompts, flow, or components into the demo.
"""

import json
import re
from uuid import uuid4

from ag_ui.core import Context, Tool, ToolCallArgsEvent, ToolCallResultEvent

from .express import ExpressCompiler

_UI_CONTEXT_PREFIXES = (
    "Generative UI guide:",
    "Generative UI markdown guide:",
    "Generative UI component schema:",
)


def prepare_express_input(input, transport):
    envelope = (input.forwarded_props or {}).get("copilotkit", {}).get("ui")
    if not isinstance(envelope, dict):
        raise TypeError("Express requires the frontend generative UI catalog.")
    compiler = ExpressCompiler(envelope)
    extensions = envelope.get("metadata", {}).get("extensions", {})
    targets = extensions.get("copilotkit_targets", [{"id": "chat"}])
    target_ids = [target["id"] for target in targets]
    if any(not re.fullmatch(r"[\w.-]+", target) for target in target_ids):
        raise ValueError(
            "Demo surface targets must contain only letters, digits, _, . or -."
        )
    # Request-local state. Never share a stream/compiler between concurrent runs.
    compiler.demo_targets = target_ids
    compiler.demo_surfaces = extensions.get("copilotkit_surfaces") or {}
    contract = (
        "Call render_ui with target and source. source is an A2UI Express program, "
        "not JSON and not a code fence. This must be a real tool call."
        if transport == "tool"
        else "Write UI as A2UI Express inside ```a2ui-express target=TARGET code fences "
        "(put a newline after the opening fence and before the closing fence). "
        "TARGET is chat or one of the page targets below. Ordinary prose may appear "
        "before and after fences. Do not use <a2ui> tags or JSON UI fences."
    )
    context = [
        c for c in input.context if not c.description.startswith(_UI_CONTEXT_PREFIXES)
    ]
    context.append(
        Context(
            description="Generative UI Express guide for this demo.",
            value="\n\n".join(
                [
                    contract,
                    compiler.instructions(),
                    (
                        'Use surface("unique-id") for a new surface. Use its existing id to update it. '
                        "Use root as the root component id. Do not call renderer functions directly. "
                        "Use only the components allowed by the chosen target. Preserve values the user edited."
                    ),
                    "Available targets: " + json.dumps(targets),
                    "Existing surfaces (including user values and rejections): "
                    + json.dumps(compiler.demo_surfaces),
                ]
            ),
        )
    )
    tools = [tool for tool in input.tools if tool.name != "render_ui"]
    if transport == "tool":
        tools.append(
            Tool(
                name="render_ui",
                description="Render UI using an A2UI Express program.",
                parameters={
                    "type": "object",
                    "properties": {
                        "target": {"type": "string", "enum": target_ids},
                        "source": {
                            "type": "string",
                            "description": "A2UI Express source. No fences.",
                        },
                    },
                    "required": ["target", "source"],
                },
            )
        )
    return input.model_copy(update={"context": context, "tools": tools}), compiler


class _Snapshots:
    """Turn compiler snapshots into ordered operations, preserving surface identity."""

    def __init__(self, compiler):
        self.compiler = compiler
        self.created = set(compiler.demo_surfaces)
        self.components = {}
        self.data = {}
        self.previous_operations = {}

    def begin(self):
        # Each fence/tool call is a new program. Recompiling its prefixes must
        # not replay effects such as deleteSurface or repeated data writes.
        self.previous_operations = {}

    def compile(self, source, final=False):
        operations = self.compiler.compile(source, final=final)
        # Commit bookkeeping only when the whole batch can be emitted. A final
        # error must not remember creates that the caller never received.
        created = self.created.copy()
        components_by_surface = self.components.copy()
        data_by_surface = self.data.copy()
        previous_operations = self.previous_operations.copy()
        result = []
        for index, operation in enumerate(operations):
            # Invalid/incomplete prefixes can compile to no operations or only
            # an earlier subset. Keep every already-emitted statement until
            # begin(), including creates preceding explicit update statements.
            if previous_operations.get(index) == operation:
                continue
            update = operation.get("updateComponents") or operation.get(
                "updateDataModel"
            )
            if update is not None and update["surfaceId"] not in created:
                # FIX(demo-bridge): SDK 0.9.0 emits updates for rootless prefixes.
                # A later create snapshot includes their components and data.
                # Do not emit or deduplicate them before that create arrives;
                # known surfaces can still stream updates without a new root.
                if final:
                    raise ValueError(
                        f'Surface "{update["surfaceId"]}" needs createSurface before updates; '
                        "define root for a new surface or use an existing surface id."
                    )
                continue
            previous_operations[index] = operation
            create = operation.get("createSurface")
            if create is None:
                result.append(operation)
                if "deleteSurface" in operation:
                    surface_id = operation["deleteSurface"]["surfaceId"]
                    created.discard(surface_id)
                    components_by_surface.pop(surface_id, None)
                    data_by_surface.pop(surface_id, None)
                elif "updateComponents" in operation:
                    surface_id = operation["updateComponents"]["surfaceId"]
                    components_by_surface.pop(surface_id, None)
                elif "updateDataModel" in operation:
                    # The write may address any JSON pointer, including a
                    # deletion. Invalidate the cached snapshot rather than
                    # treating its old data as the renderer's current data.
                    surface_id = operation["updateDataModel"]["surfaceId"]
                    data_by_surface.pop(surface_id, None)
                continue
            surface_id = create["surfaceId"]
            components = create.get("components", [])
            data = create.get("dataModel", {})
            if surface_id not in created:
                result.append(operation)
                created.add(surface_id)
            else:
                previous = components_by_surface.get(surface_id, {})
                changed = [
                    node for node in components if previous.get(node["id"]) != node
                ]
                if changed:
                    result.append(
                        {
                            "version": "v1.0",
                            "updateComponents": {
                                "surfaceId": surface_id,
                                "components": changed,
                            },
                        }
                    )
                if "dataModel" in create and data != data_by_surface.get(surface_id):
                    result.append(
                        {
                            "version": "v1.0",
                            "updateDataModel": {
                                "surfaceId": surface_id,
                                "path": "/",
                                "value": data,
                            },
                        }
                    )
            components_by_surface[surface_id] = {
                node["id"]: node for node in components
            }
            if "dataModel" in create:
                data_by_surface[surface_id] = data
        self.created = created
        self.components = components_by_surface
        self.data = data_by_surface
        self.previous_operations = previous_operations
        return result


# WORKAROUND(a2ui-agent-sdk 0.9.0): ExpressParser.supports_streaming is False
# and parse_chunk raises NotImplementedError. Recompile valid prefixes and diff
# snapshots until the SDK provides incremental v1.0 operations. Regressions:
# tests/test_transport.py (early render, arbitrary splits), test_snapshots.py.
# This is demo-local; remove this compiler-stream bridge when upstream supports it.
class _Markdown:
    def __init__(self, compiler, snapshots):
        self.compiler = compiler
        self.snapshots = snapshots
        self.pending = ""
        self.source = ""
        self.mode = "prose"
        self.target = "chat"

    def _render(self, final=False):
        try:
            operations = self.snapshots.compile(self.source, final=final)
        except ValueError:
            if final:
                raise
            return ""  # Incomplete syntax is expected between token chunks.
        if not operations:
            return ""
        return (
            "\n```a2ui target="
            + self.target
            + "\n"
            + json.dumps(operations)
            + "\n```\n"
        )

    def feed(self, delta, final=False):
        self.pending += delta
        output = []
        while self.pending:
            if self.mode == "express":
                # A token chunk can start in the middle of a quoted string.
                # Only the accumulated source determines whether ^ is a line start.
                line_start = (
                    r"(?:^|\n)"
                    if not self.source or self.source.endswith("\n")
                    else r"\n"
                )
                close = re.search(line_start + r"```[ \t]*(?:\n|$)", self.pending)
                if close:
                    self.source += self.pending[: close.start()]
                    output.append(self._render(final=True))
                    self.pending = self.pending[close.end() :]
                    self.source = ""
                    self.mode = "prose"
                    continue
                # Hold a potential closing fence split over token boundaries.
                tail = re.search(line_start + r"`{1,3}[ \t]*$", self.pending)
                if tail and not final:
                    self.source += self.pending[: tail.start()]
                    self.pending = self.pending[tail.start() :]
                else:
                    self.source += self.pending
                    self.pending = ""
                output.append(self._render(final=final))
                break

            marker = self.pending.find("```")
            if marker < 0:
                keep = 0 if final else len(self.pending) - len(self.pending.rstrip("`"))
                if keep:
                    output.append(self.pending[:-keep])
                    self.pending = self.pending[-keep:]
                else:
                    output.append(self.pending)
                    self.pending = ""
                break
            output.append(self.pending[:marker])
            self.pending = self.pending[marker:]
            if self.mode == "code":
                output.append("```")
                self.pending = self.pending[3:]
                self.mode = "prose"
                continue
            newline = self.pending.find("\n")
            if newline < 0:
                if final:
                    if self.pending.startswith("```a2ui-express"):
                        raise ValueError("Truncated Express fence header.")
                    output.append(self.pending)
                    self.pending = ""
                break
            header = self.pending[3:newline].strip()
            self.pending = self.pending[newline + 1 :]
            if header.split(" ", 1)[0] == "a2ui-express":
                match = re.fullmatch(r"a2ui-express(?:\s+target=([\w.-]+))?", header)
                if not match:
                    raise ValueError("Invalid Express fence header.")
                self.target = match.group(1) or "chat"
                if self.target not in self.compiler.demo_targets:
                    raise ValueError("Unknown UI target: " + self.target)
                self.snapshots.begin()
                self.mode = "express"
            else:
                output.append("```" + header + "\n")
                self.mode = "code"
        if final and self.mode == "express":
            # Also validates a truncated/unclosed block when the model stops.
            output.append(self._render(final=True))
            self.source = ""
            self.mode = "prose"
        return "".join(output)


async def transform_express_events(events, compiler, transport):
    snapshots = _Snapshots(compiler)
    markdown = {}
    tool_calls = {}
    try:
        async for event in events:
            if transport == "markdown" and event.type == "TEXT_MESSAGE_CONTENT":
                stream = markdown.setdefault(
                    event.message_id, _Markdown(compiler, snapshots)
                )
                delta = stream.feed(event.delta)
                if delta:
                    yield event.model_copy(update={"delta": delta})
            elif transport == "markdown" and event.type == "TEXT_MESSAGE_END":
                stream = markdown.pop(event.message_id, None)
                if stream:
                    delta = stream.feed("", final=True)
                    if delta:
                        from ag_ui.core import TextMessageContentEvent

                        yield TextMessageContentEvent(
                            message_id=event.message_id, delta=delta
                        )
                yield event
            elif (
                transport == "tool"
                and event.type == "TOOL_CALL_START"
                and event.tool_call_name == "render_ui"
            ):
                tool_calls[event.tool_call_id] = ""
                yield event
            elif event.type == "TOOL_CALL_ARGS" and event.tool_call_id in tool_calls:
                tool_calls[event.tool_call_id] += event.delta
            elif event.type == "TOOL_CALL_END" and event.tool_call_id in tool_calls:
                raw = tool_calls.pop(event.tool_call_id)
                error = None
                target = "chat"
                try:
                    args = json.loads(raw)
                    target = args["target"]
                    if target not in compiler.demo_targets:
                        raise ValueError("Unknown UI target: " + str(target))
                    source = args["source"]
                    if not isinstance(source, str):
                        raise TypeError("render_ui source must be an Express string.")
                    snapshots.begin()
                    operations = snapshots.compile(source, final=True)
                except (ValueError, KeyError, TypeError) as exc:
                    error = str(exc)
                    operations = []
                yield ToolCallArgsEvent(
                    tool_call_id=event.tool_call_id,
                    delta=json.dumps(
                        {
                            "target": target,
                            "operations": operations,
                        }
                    ),
                )
                yield event
                if error:
                    yield ToolCallResultEvent(
                        message_id=str(uuid4()),
                        tool_call_id=event.tool_call_id,
                        content=json.dumps(
                            {
                                "status": "error",
                                "reason": "Express compilation failed: " + error,
                            }
                        ),
                    )
            else:
                yield event
    finally:
        # Closing the HTTP stream must also cancel ADK's background execution.
        close = getattr(events, "aclose", None)
        if close:
            await close()
