"""Native Google ADK toolset backed by one verified Registry snapshot."""

from __future__ import annotations

from typing import Any

from google.adk.tools.base_tool import BaseTool
from google.adk.tools.base_toolset import BaseToolset
from google.genai import types

from ._snapshot import RenderedSkill
from .registry import SkillRegistry


class _SkillInstructionTool(BaseTool):
    def __init__(self, record: RenderedSkill) -> None:
        description = (
            record.description or f"Load the {record.name} skill instructions."
        )
        super().__init__(
            name=f"copilotkit_skill_{record.position:03d}",
            description=description,
        )
        self.record = record

    def _get_declaration(self) -> types.FunctionDeclaration:
        return types.FunctionDeclaration(
            name=self.name,
            description=self.description,
            parameters_json_schema={"type": "object", "properties": {}},
        )

    async def run_async(self, *, args: dict[str, Any], tool_context: Any) -> Any:
        del args, tool_context
        return self.record.as_native()


class SkillToolset(BaseToolset):
    """Materializes safe instruction tools from one `SkillRegistry` snapshot."""

    def __init__(self, registry: SkillRegistry) -> None:
        self._registry = registry

    async def get_tools(self, readonly_context: Any = None) -> list[BaseTool]:
        del readonly_context
        snapshot = await self._registry.load()
        return [_SkillInstructionTool(record) for record in snapshot.skills]
