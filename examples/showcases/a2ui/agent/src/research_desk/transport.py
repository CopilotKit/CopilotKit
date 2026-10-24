"""Demo-only Express boundary; the CopilotKit client still receives A2UI JSON.

Recompile valid prefixes with the released SDK while text arrives. The browser
retains its native catalog, renderer, targets, events and client functions.
"""

import json
import re
from collections.abc import AsyncIterator

from ag_ui.core import BaseEvent, Context, RunAgentInput, TextMessageContentEvent

from .express import ExpressCompiler

_UI_CONTEXT_PREFIXES = (
    "Generative UI guide:",
    "Generative UI markdown guide:",
    "Generative UI component schema:",
)


def prepare_express_input(
    input: RunAgentInput,
) -> tuple[RunAgentInput, ExpressCompiler]:
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
        "Write UI as A2UI Express inside ```a2ui-express target=TARGET code fences "
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
                        'Use surface("unique-id") for a new surface. Use surface("existing-id", update=true) for partial updates. '
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
    return input.model_copy(update={"context": context, "tools": tools}), compiler


class _Snapshots:
    """Turn compiler snapshots into ordered operations, preserving surface identity."""

    def __init__(self, compiler):
        self.compiler = compiler
        self.created = set(compiler.demo_surfaces)
        self.complete_trees = set()
        self.components = {}
        self.data = {}
        self.previous_operations = {}

    def begin(self):
        # Each fence is a new program. Recompiling its prefixes must
        # not replay effects such as deleteSurface or repeated data writes.
        self.previous_operations = {}

    def compile(self, source, final=False):
        try:
            return self._compile(source, final)
        except ValueError:
            if final:
                raise
            return []

    def _compile(self, source, final):
        operations = self.compiler.compile(source, final=final)
        # Deleting an existing UI is irreversible within a partial snapshot.
        # Wait for this entire program to validate before emitting any of its
        # operations. Ordinary create/update programs still preview as they grow.
        if not final and any("deleteSurface" in op for op in operations):
            return []
        # Commit bookkeeping only when the whole batch can be emitted. A final
        # error must not remember creates that the caller never received.
        created = self.created.copy()
        complete_trees = self.complete_trees.copy()
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
                    complete_trees.discard(surface_id)
                    components_by_surface.pop(surface_id, None)
                    data_by_surface.pop(surface_id, None)
                elif "updateComponents" in operation:
                    surface_id = operation["updateComponents"]["surfaceId"]
                    current = components_by_surface.get(surface_id, {})
                    merged = {
                        **current,
                        **{
                            node["id"]: node
                            for node in operation["updateComponents"]["components"]
                        },
                    }
                    self.compiler.validate_surface(
                        list(merged.values()), partial=surface_id not in complete_trees
                    )
                    components_by_surface[surface_id] = merged
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
            complete_trees.add(surface_id)
            components_by_surface[surface_id] = {
                node["id"]: node for node in components
            }
            if "dataModel" in create:
                data_by_surface[surface_id] = data
        self.created = created
        self.complete_trees = complete_trees
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
                close = re.search(line_start + r"```[ \t]*\r?(?:\n|$)", self.pending)
                if close:
                    self.source += self.pending[: close.start()]
                    output.append(self._render(final=True))
                    self.pending = self.pending[close.end() :]
                    self.source = ""
                    self.mode = "prose"
                    continue
                # Hold a potential closing fence split over token boundaries.
                tail = re.search(line_start + r"`{1,3}[ \t]*\r?$", self.pending)
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
            opening = self.pending[: newline + 1]
            header = self.pending[3:newline].strip()
            self.pending = self.pending[newline + 1 :]
            if header.split(maxsplit=1)[:1] == ["a2ui-express"]:
                match = re.fullmatch(r"a2ui-express(?:\s+target=([\w.-]+))?", header)
                if not match:
                    raise ValueError("Invalid Express fence header.")
                self.target = match.group(1) or "chat"
                if self.target not in self.compiler.demo_targets:
                    raise ValueError("Unknown UI target: " + self.target)
                self.snapshots.begin()
                self.mode = "express"
            else:
                output.append(opening)
                self.mode = "code"
        if final and self.mode == "express":
            # Also validates a truncated/unclosed block when the model stops.
            output.append(self._render(final=True))
            self.source = ""
            self.mode = "prose"
        return "".join(output)


async def transform_express_events(
    events: AsyncIterator[BaseEvent], compiler: ExpressCompiler
) -> AsyncIterator[BaseEvent]:
    """Compile markdown, preserving every non-text event and closing its source.

    Invalid final input raises ValueError. The runner emits RUN_ERROR and must
    not emit RUN_FINISHED afterward; already validated previews remain visible.
    """
    snapshots = _Snapshots(compiler)
    markdown = {}

    def flush(message_id):
        stream = markdown.pop(message_id)
        delta = stream.feed("", final=True)
        if delta:
            return TextMessageContentEvent(message_id=message_id, delta=delta)
        return None

    try:
        async for event in events:
            if event.type == "TEXT_MESSAGE_CONTENT":
                stream = markdown.setdefault(
                    event.message_id, _Markdown(compiler, snapshots)
                )
                delta = stream.feed(event.delta)
                if delta:
                    yield event.model_copy(update={"delta": delta})
            elif event.type == "TEXT_MESSAGE_END":
                if event.message_id in markdown:
                    tail = flush(event.message_id)
                    if tail:
                        yield tail
                yield event
            elif event.type == "RUN_ERROR":
                # The provider already ended the run. Its failure is authoritative:
                # discard unfinished UI rather than flushing a second error or
                # forwarding content after this terminal event. finally closes ADK.
                markdown.clear()
                yield event
                return
            elif event.type == "RUN_FINISHED":
                # Validate before forwarding success even if ADK omitted a text end.
                for message_id in list(markdown):
                    tail = flush(message_id)
                    if tail:
                        yield tail
                yield event
            else:
                yield event
        for message_id in list(markdown):
            tail = flush(message_id)
            if tail:
                yield tail
    finally:
        # Closing the HTTP stream must also cancel ADK's background execution.
        close = getattr(events, "aclose", None)
        if close:
            await close()
