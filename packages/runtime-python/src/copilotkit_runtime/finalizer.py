"""Track unfinished AG-UI streams without retaining message or tool content."""

import json

from .models import Json


class EventFinalizer:
    """Append TS-compatible closers only when the source omitted a terminal event."""

    def __init__(self) -> None:
        self.messages: dict[str, None] = {}
        self.tools: dict[str, tuple[bool, bool]] = {}
        self.terminal = False

    def observe(self, event: Json) -> None:
        """Retain only open identifiers and terminal status from an emitted event."""
        kind = event.get("type")
        message = event.get("messageId")
        tool = event.get("toolCallId")
        if kind in ("RUN_FINISHED", "RUN_ERROR"):
            self.terminal = True
        elif kind == "TEXT_MESSAGE_START" and isinstance(message, str):
            self.messages[message] = None
        elif kind == "TEXT_MESSAGE_END" and isinstance(message, str):
            self.messages.pop(message, None)
        elif kind == "TOOL_CALL_START" and isinstance(tool, str):
            self.tools[tool] = (False, False)
        elif isinstance(tool, str) and tool in self.tools:
            ended, result = self.tools[tool]
            self.tools[tool] = (
                ended or kind == "TOOL_CALL_END",
                result or kind == "TOOL_CALL_RESULT",
            )

    def finish(self, *, stop_requested: bool = False) -> list[Json]:
        """Close missing streams and emit a clean stop or an incomplete-stream error."""
        if self.terminal:
            return []
        message = (
            "Run stopped by user"
            if stop_requested
            else "Run ended without emitting a terminal event"
        )
        result: list[Json] = [
            {"type": "TEXT_MESSAGE_END", "messageId": key} for key in self.messages
        ]
        for key, (ended, has_result) in self.tools.items():
            if not ended:
                result.append({"type": "TOOL_CALL_END", "toolCallId": key})
            if not has_result:
                result.append(
                    {
                        "type": "TOOL_CALL_RESULT",
                        "toolCallId": key,
                        "messageId": f"{key}-result",
                        "role": "tool",
                        "content": json.dumps(
                            {
                                "status": "stopped" if stop_requested else "error",
                                "reason": "stop_requested"
                                if stop_requested
                                else "missing_terminal_event",
                                "message": message,
                            },
                            separators=(",", ":"),
                        ),
                    }
                )
        result.append(
            {"type": "RUN_FINISHED"}
            if stop_requested
            else {"type": "RUN_ERROR", "message": message, "code": "INCOMPLETE_STREAM"}
        )
        return result
