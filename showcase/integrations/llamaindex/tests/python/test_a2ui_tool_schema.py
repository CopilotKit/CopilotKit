"""Check the installed AG-UI adapter's client-tool schema boundary."""

from ag_ui.core import Tool
from llama_index.protocols.ag_ui.agent import _ag_ui_tool_to_llama_index


def test_injected_a2ui_components_remain_an_array() -> None:
    render_tool = Tool(
        name="render_a2ui",
        description="Render an A2UI surface",
        parameters={
            "type": "object",
            "properties": {
                "surfaceId": {"type": "string"},
                "components": {"type": "array", "items": {"type": "object"}},
            },
            "required": ["surfaceId", "components"],
        },
    )

    model_schema = _ag_ui_tool_to_llama_index(render_tool).metadata.to_openai_tool()
    components = model_schema["function"]["parameters"]["properties"]["components"]

    assert components == {"type": "array", "items": {"type": "object"}}
