"""Claude Agent SDK (Python) backing the Tool-Based Generative UI demo.

Exposes a single `generate_haiku` tool that the frontend renders as a haiku card
via useFrontendTool. Backend only acknowledges the invocation.
"""

from __future__ import annotations

from textwrap import dedent
from typing import Any

from ag_ui_runner import make_runner
from pydantic import BaseModel


VALID_IMAGE_NAMES = [
    "Osaka_Castle_Turret_Stone_Wall_Pine_Trees_Daytime.jpg",
    "Tokyo_Skyline_Night_Tokyo_Tower_Mount_Fuji_View.jpg",
    "Itsukushima_Shrine_Miyajima_Floating_Torii_Gate_Sunset_Long_Exposure.jpg",
    "Takachiho_Gorge_Waterfall_River_Lush_Greenery_Japan.jpg",
    "Bonsai_Tree_Potted_Japanese_Art_Green_Foliage.jpeg",
    "Shirakawa-go_Gassho-zukuri_Thatched_Roof_Village_Aerial_View.jpg",
    "Ginkaku-ji_Silver_Pavilion_Kyoto_Japanese_Garden_Pond_Reflection.jpg",
    "Senso-ji_Temple_Asakusa_Cherry_Blossoms_Kimono_Umbrella.jpg",
    "Cherry_Blossoms_Sakura_Night_View_City_Lights_Japan.jpg",
    "Mount_Fuji_Lake_Reflection_Cherry_Blossoms_Sakura_Spring.jpg",
]


TOOLS: list[dict[str, Any]] = [
    {
        "name": "generate_haiku",
        "description": (
            "Generate a haiku with Japanese lines, English translation, a relevant "
            "image name, and a CSS gradient. Frontend renders the result."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "japanese": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "3 lines of haiku in Japanese.",
                },
                "english": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "3 lines of haiku translated to English.",
                },
                "image_name": {
                    "type": "string",
                    "description": f"One of: {', '.join(VALID_IMAGE_NAMES)}",
                },
                "gradient": {
                    "type": "string",
                    "description": "CSS gradient background.",
                },
            },
            "required": ["japanese", "english", "image_name", "gradient"],
        },
    },
]


SYSTEM_PROMPT = dedent(
    f"""
    You are a creative haiku writer.

    When the user asks for a haiku, call `generate_haiku` with:
      - 3 Japanese lines
      - 3 English translation lines
      - image_name chosen from: {', '.join(VALID_IMAGE_NAMES)}
      - a soft CSS gradient suited to the mood

    Do not reply with the haiku text -- the UI renders it from the tool call.
    """
).strip()


class AgentState(BaseModel):
    pass


def execute_tool(name: str, tool_input: dict[str, Any], state: AgentState) -> tuple[str, AgentState | None]:
    if name == "generate_haiku":
        return "Haiku generated!", None
    return f"Unknown tool: {name}", None


run_agent = make_runner(
    tools=TOOLS,
    system_prompt=SYSTEM_PROMPT,
    state_cls=AgentState,
    execute_tool=execute_tool,
)
