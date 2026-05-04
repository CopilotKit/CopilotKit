"""
Main entry point for the LangGraph agent.
Uses Gemini 3 (gemini-3-pro-preview) for text generation.
Main agent writes all prompts directly (no subagents).
"""

import os
import uuid
import httpx
import base64
import asyncio
import time
from pathlib import Path
from typing import Any, List, Annotated
from typing_extensions import Literal
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import SystemMessage
from langchain_core.runnables import RunnableConfig
from langchain.tools import tool
from langgraph.graph import StateGraph, END
from langgraph.types import Command
from langgraph.graph import MessagesState
from langgraph.prebuilt import ToolNode, InjectedState


# === Generated images directory ===
GENERATED_DIR = Path(__file__).parent / "generated"
GENERATED_DIR.mkdir(exist_ok=True)


def get_agent_url() -> str:
    """Get the agent's base URL for serving static files."""
    return os.getenv("AGENT_URL", "http://localhost:8000")


def get_image_path(image_url: str) -> Path:
    """Convert image URL to local file path."""
    # Strip query parameters (e.g., ?t=123456 cache busting)
    base_url = image_url.split("?")[0]

    # Handle absolute URLs from agent
    agent_url = get_agent_url()
    if base_url.startswith(agent_url):
        base_url = base_url[len(agent_url):]

    # Handle relative /generated/ URLs
    if base_url.startswith("/generated/"):
        filename = base_url.replace("/generated/", "")
        return GENERATED_DIR / filename

    # Fallback to direct path
    return Path(base_url)


# === State definition ===

class AgentState(MessagesState):
    """Agent state with scene generation artifacts."""
    characters: List[dict] = []
    backgrounds: List[dict] = []
    scenes: List[dict] = []
    tools: List[Any]  # CopilotKit tools
    apiKey: str = ""  # Dynamic API key from frontend


def get_model(api_key: str = None):
    """Get configured Gemini 3 model."""
    kwargs = {
        "model": os.getenv("GEMINI_MODEL", "gemini-3-pro-preview"),
        "temperature": 1.0,
    }
    if api_key:
        kwargs["google_api_key"] = api_key
    return ChatGoogleGenerativeAI(**kwargs)


async def generate_image(prompt: str, input_images: List[str] = None, api_key: str = None) -> str:
    """Generate an image using Nano Banana (gemini-2.5-flash-image) via HTTP.

    Args:
        prompt: The image generation prompt
        input_images: Optional list of image file paths to include for composition
        api_key: Google API key (from state or env)

    Returns:
        URL path to the generated image (e.g., /generated/abc123.png)
    """
    if not api_key:
        api_key = os.getenv("GOOGLE_API_KEY")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent"

    # Build parts array
    parts = []

    # Add input images first (for composition)
    if input_images:
        for img_path in input_images:
            # Strip query parameters (e.g., ?t=123456 cache busting)
            base_img_path = img_path.split("?")[0]

            # Convert URL to file path
            file_path = get_image_path(base_img_path)

            if file_path.exists():
                # Read image and encode as base64
                def read_image(fp):
                    return fp.read_bytes()

                image_bytes = await asyncio.to_thread(read_image, file_path)
                image_base64 = base64.b64encode(image_bytes).decode("utf-8")

                parts.append({
                    "inline_data": {
                        "mime_type": "image/png",
                        "data": image_base64
                    }
                })

    # Add text prompt
    parts.append({"text": prompt})

    payload = {
        "contents": [{
            "parts": parts
        }],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"]
        }
    }

    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": api_key
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(url, json=payload, headers=headers)
        response.raise_for_status()
        data = response.json()

    # Extract image data from response and save to disk
    if "candidates" in data and len(data["candidates"]) > 0:
        parts = data["candidates"][0].get("content", {}).get("parts", [])
        for part in parts:
            if "inlineData" in part:
                image_data = part["inlineData"]["data"]
                mime_type = part["inlineData"].get("mimeType", "image/png")

                # Determine file extension
                ext = "png" if "png" in mime_type else "jpg"

                # Generate unique filename
                filename = f"{uuid.uuid4()}.{ext}"

                # Save to agent's generated directory
                output_path = GENERATED_DIR / filename

                # Decode and save (using to_thread for async compatibility)
                image_bytes = base64.b64decode(image_data)

                def save_image():
                    output_path.write_bytes(image_bytes)

                await asyncio.to_thread(save_image)

                # Return absolute URL that frontend can use
                return f"{get_agent_url()}/generated/{filename}"

    return None


async def edit_image(image_url: str, edit_prompt: str, api_key: str = None) -> str:
    """Edit an existing image using Nano Banana.

    Args:
        image_url: URL to the existing image (absolute or relative)
        edit_prompt: Description of the changes to make
        api_key: Google API key (from state or env)

    Returns:
        URL to the edited image (overwrites the original)
    """
    if not api_key:
        api_key = os.getenv("GOOGLE_API_KEY")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent"

    # Convert URL to file path
    file_path = get_image_path(image_url)

    if not file_path.exists():
        return None

    # Read and encode image
    def read_image(fp):
        return fp.read_bytes()

    image_bytes = await asyncio.to_thread(read_image, file_path)
    image_base64 = base64.b64encode(image_bytes).decode("utf-8")

    # Build request with image and edit prompt
    payload = {
        "contents": [{
            "parts": [
                {
                    "inline_data": {
                        "mime_type": "image/png",
                        "data": image_base64
                    }
                },
                {"text": edit_prompt}
            ]
        }],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"]
        }
    }

    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": api_key
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(url, json=payload, headers=headers)
        response.raise_for_status()
        data = response.json()

    # Extract and save the edited image (overwrite original)
    if "candidates" in data and len(data["candidates"]) > 0:
        parts = data["candidates"][0].get("content", {}).get("parts", [])
        for part in parts:
            if "inlineData" in part:
                image_data = part["inlineData"]["data"]
                new_image_bytes = base64.b64decode(image_data)

                def save_image():
                    file_path.write_bytes(new_image_bytes)

                await asyncio.to_thread(save_image)

                # Return absolute URL with cache-busting timestamp
                filename = file_path.name
                return f"{get_agent_url()}/generated/{filename}?t={int(time.time() * 1000)}"

    return None


# === Backend tools for the main agent ===

@tool
async def create_character(
    name: str,
    description: str,
    prompt: str,
    state: Annotated[dict, InjectedState]
) -> dict:
    """Create a new character with an AI-generated image.

    Args:
        name: Name of the character
        description: Brief description for the user (1 sentence)
        prompt: Detailed image generation prompt (50-100 words, include visual details, art style, pose, lighting)

    Returns:
        Character data including id, name, description, prompt, and imageUrl
    """
    # Get API key from state
    api_key = state.get("apiKey", "")

    # Generate the character image using Nano Banana
    image_url = await generate_image(prompt, api_key=api_key)

    character_id = str(uuid.uuid4())

    return {
        "id": character_id,
        "name": name,
        "description": description,
        "prompt": prompt,
        "imageUrl": image_url
    }


@tool
async def create_background(
    name: str,
    description: str,
    prompt: str,
    state: Annotated[dict, InjectedState]
) -> dict:
    """Create a new background/environment with an AI-generated image.

    Args:
        name: Name of the background/environment
        description: Brief description for the user (1 sentence)
        prompt: Detailed image generation prompt (50-100 words, include environment details, lighting, atmosphere)

    Returns:
        Background data including id, name, description, prompt, and imageUrl
    """
    # Get API key from state
    api_key = state.get("apiKey", "")

    # Generate the background image using Nano Banana
    image_url = await generate_image(prompt, api_key=api_key)

    background_id = str(uuid.uuid4())

    return {
        "id": background_id,
        "name": name,
        "description": description,
        "prompt": prompt,
        "imageUrl": image_url
    }


@tool
async def create_scene(
    name: str,
    description: str,
    prompt: str,
    character_ids: List[str],
    background_id: str,
    state: Annotated[dict, InjectedState]
) -> dict:
    """Create a scene by composing characters with a background.

    Args:
        name: Name of the scene
        description: Brief description for the user (1 sentence)
        prompt: Detailed image generation prompt for the composed scene (75-125 words)
        character_ids: List of character IDs to include in the scene
        background_id: ID of the background to use

    Returns:
        Scene data including id, name, description, prompt, and imageUrl
    """
    # Get characters and backgrounds from state
    characters = state.get("characters", [])
    backgrounds = state.get("backgrounds", [])

    # Collect images for composition
    input_images = []

    # Validate and collect character images
    for char_id in character_ids:
        char = next((c for c in characters if c["id"] == char_id), None)
        if not char:
            return {"error": f"Character with id {char_id} not found"}
        if not char.get("imageUrl"):
            return {"error": f"Character '{char.get('name', char_id)}' has no image"}
        input_images.append(char["imageUrl"])

    # Validate and collect background image
    bg = next((b for b in backgrounds if b["id"] == background_id), None)
    if not bg:
        return {"error": f"Background with id {background_id} not found"}
    if not bg.get("imageUrl"):
        return {"error": f"Background '{bg.get('name', background_id)}' has no image"}
    input_images.append(bg["imageUrl"])

    # Get API key from state
    api_key = state.get("apiKey", "")

    # Generate the scene image using Nano Banana with character/background images
    image_url = await generate_image(prompt, input_images, api_key=api_key)

    scene_id = str(uuid.uuid4())

    return {
        "id": scene_id,
        "name": name,
        "description": description,
        "characterIds": character_ids,
        "backgroundId": background_id,
        "prompt": prompt,
        "imageUrl": image_url
    }


@tool
async def edit_character(
    character_id: str,
    edit_description: str,
    state: Annotated[dict, InjectedState]
) -> dict:
    """Edit an existing character's image based on user description.

    Args:
        character_id: ID of the character to edit
        edit_description: Description of the changes to make

    Returns:
        Updated character data
    """
    # Find the character from state
    characters = state.get("characters", [])
    char = next((c for c in characters if c["id"] == character_id), None)
    if not char:
        return {"error": f"Character with id {character_id} not found"}

    if not char.get("imageUrl"):
        return {"error": "Character has no image to edit"}

    # Get API key from state
    api_key = state.get("apiKey", "")

    # Edit the image
    edited_url = await edit_image(
        char["imageUrl"],
        f"Edit this character image: {edit_description}. Keep the same character but apply the requested changes.",
        api_key=api_key
    )

    if not edited_url:
        return {"error": "Failed to edit image"}

    return {
        "id": char["id"],
        "name": char["name"],
        "description": char["description"],
        "prompt": char.get("prompt", ""),
        "imageUrl": edited_url,
        "edited": True
    }


@tool
async def edit_background(
    background_id: str,
    edit_description: str,
    state: Annotated[dict, InjectedState]
) -> dict:
    """Edit an existing background's image based on user description.

    Args:
        background_id: ID of the background to edit
        edit_description: Description of the changes to make

    Returns:
        Updated background data
    """
    # Find the background from state
    backgrounds = state.get("backgrounds", [])
    bg = next((b for b in backgrounds if b["id"] == background_id), None)
    if not bg:
        return {"error": f"Background with id {background_id} not found"}

    if not bg.get("imageUrl"):
        return {"error": "Background has no image to edit"}

    # Get API key from state
    api_key = state.get("apiKey", "")

    # Edit the image
    edited_url = await edit_image(
        bg["imageUrl"],
        f"Edit this background image: {edit_description}. Keep the same environment but apply the requested changes.",
        api_key=api_key
    )

    if not edited_url:
        return {"error": "Failed to edit image"}

    return {
        "id": bg["id"],
        "name": bg["name"],
        "description": bg["description"],
        "prompt": bg.get("prompt", ""),
        "imageUrl": edited_url,
        "edited": True
    }


@tool
async def edit_scene(
    scene_id: str,
    edit_description: str,
    regenerate_from_sources: bool,
    state: Annotated[dict, InjectedState],
    new_character_ids: List[str] = None,
    new_background_id: str = None
) -> dict:
    """Edit an existing scene's image.

    Args:
        scene_id: ID of the scene to edit
        edit_description: Description of the changes to make (write full composition prompt for regenerate_from_sources=True)
        regenerate_from_sources: If True, regenerate scene from current character/background images (use after editing a character or background, or adding new characters). If False, edit the scene image directly (use for composition changes).
        new_character_ids: Optional new list of character IDs (use when adding/removing characters from the scene)
        new_background_id: Optional new background ID (use when changing the scene's background)

    Returns:
        Updated scene data
    """
    # Find the scene from state
    scenes = state.get("scenes", [])
    scene = next((s for s in scenes if s["id"] == scene_id), None)
    if not scene:
        return {"error": f"Scene with id {scene_id} not found"}

    if regenerate_from_sources:
        # Regenerate scene from updated character/background images
        characters = state.get("characters", [])
        backgrounds = state.get("backgrounds", [])

        # Use new IDs if provided, otherwise use existing
        char_ids = new_character_ids if new_character_ids is not None else scene.get("characterIds", [])
        bg_id = new_background_id if new_background_id is not None else scene.get("backgroundId", "")

        input_images = []

        # Collect character images
        for char_id in char_ids:
            char = next((c for c in characters if c["id"] == char_id), None)
            if char and char.get("imageUrl"):
                input_images.append(char["imageUrl"])

        # Collect background image
        bg = next((b for b in backgrounds if b["id"] == bg_id), None)
        if bg and bg.get("imageUrl"):
            input_images.append(bg["imageUrl"])

        if not input_images:
            return {"error": "No source images found for regeneration"}

        # Get API key from state
        api_key = state.get("apiKey", "")

        # Generate new scene with updated sources
        new_url = await generate_image(edit_description, input_images, api_key=api_key)

        if not new_url:
            return {"error": "Failed to regenerate scene"}

        return {
            "id": scene["id"],
            "name": scene["name"],
            "description": scene["description"],
            "characterIds": char_ids,
            "backgroundId": bg_id,
            "prompt": edit_description,
            "imageUrl": new_url,
            "edited": True
        }
    else:
        # Edit the existing scene image directly (for composition changes)
        if not scene.get("imageUrl"):
            return {"error": "Scene has no image to edit"}

        # Get API key from state
        api_key = state.get("apiKey", "")

        edited_url = await edit_image(
            scene["imageUrl"],
            f"Edit this scene image: {edit_description}. Keep the same composition but apply the requested changes.",
            api_key=api_key
        )

        if not edited_url:
            return {"error": "Failed to edit image"}

        return {
            "id": scene["id"],
            "name": scene["name"],
            "description": scene["description"],
            "characterIds": scene.get("characterIds", []),
            "backgroundId": scene.get("backgroundId", ""),
            "prompt": scene.get("prompt", ""),
            "imageUrl": edited_url,
            "edited": True
        }


# Backend tools list
backend_tools = [create_character, create_background, create_scene, edit_character, edit_background, edit_scene]
backend_tool_names = [tool.name for tool in backend_tools]


# === Main agent nodes ===

async def chat_node(state: AgentState, config: RunnableConfig) -> Command[Literal["tool_node", "__end__"]]:
    """Main agent that handles user requests and writes prompts directly."""

    # Extract API key from shared state (passed from frontend via setState)
    api_key = state.get("apiKey", "") or os.getenv("GOOGLE_API_KEY", "")

    # Use to_thread to avoid blocking the event loop during model initialization
    model = await asyncio.to_thread(get_model, api_key)

    # Bind both CopilotKit tools and backend tools
    all_tools = [*state.get("tools", []), *backend_tools]
    model_with_tools = model.bind_tools(all_tools, parallel_tool_calls=False)

    # Build context about current artifacts
    chars = state.get("characters", [])
    bgs = state.get("backgrounds", [])
    scenes = state.get("scenes", [])

    char_list = "\n".join([f"  - {c['name']} (id: {c['id']}): {c['description']}" for c in chars]) or "  None yet"
    bg_list = "\n".join([f"  - {b['name']} (id: {b['id']}): {b['description']}" for b in bgs]) or "  None yet"
    scene_list = "\n".join([f"  - {s['name']} (id: {s['id']}): {s['description']}" for s in scenes]) or "  None yet"

    system_message = SystemMessage(content=f"""You are a creative assistant helping users create scenes with AI-generated characters and backgrounds.

## Your Capabilities
You have tools to create and edit characters, backgrounds, and scenes. When calling these tools, YOU write the image generation prompts directly.

**Tools available:**
- **approve_image_prompt(artifact_type, name, prompt)**: REQUIRED before creating! Gets user approval for the prompt
- **create_character(name, description, prompt)**: Create a character image
- **create_background(name, description, prompt)**: Create a background image
- **create_scene(name, description, prompt, character_ids, background_id)**: Compose a scene from characters + background
- **edit_character/edit_background/edit_scene**: Edit existing images

## CRITICAL: Human-in-the-Loop Approval
**Before calling create_character, create_background, or create_scene, you MUST first call approve_image_prompt.**

Workflow:
1. Call approve_image_prompt with artifact_type ("character"/"background"/"scene"), name, and your proposed prompt
2. Wait for user to approve (they may edit the prompt)
3. If approved, the result will contain the final prompt - use THAT prompt when calling create_*
4. If cancelled, do NOT call the create tool

Example flow:
- User: "Create a warrior character"
- You: Call approve_image_prompt(artifact_type="character", name="Warrior", prompt="A fierce warrior...")
- [User approves with maybe edited prompt]
- You: Call create_character(name="Warrior", description="...", prompt="<the approved prompt from result>")

## Current Session State
Characters:
{char_list}

Backgrounds:
{bg_list}

Scenes:
{scene_list}

## Prompt Writing Guidelines
Keep prompts SIMPLE and SHORT. Nano Banana works better with minimal constraints.

**For characters:**
- Keep it simple: "Create a photo of [character description]"
- IMPORTANT: Always add "on a plain white background" or "studio photo" to get clean images for compositing
- Example: "Create a photo of CJ from GTA San Andreas on a plain white background"

**For backgrounds:**
- Keep it simple: "[environment description]"
- Example: "Grove Street neighborhood in Los Santos"

**For scenes:**
- Just describe how to place the characters: "Place these characters in this environment naturally"
- Add activity if needed: "Place these characters in this environment, they are walking together"
- Keep it SHORT - don't over-describe

## Workflow Guidelines
1. When creating artifacts, write creative names, brief descriptions, and detailed prompts
2. For scenes, ensure user has at least one character and one background first
3. When editing, the edit_description should clearly state what changes to make
4. Be creative and helpful - suggest ideas if user is unsure
5. **Adding elements to existing scenes**: If user asks to add a character to an existing scene:
   - Do NOT create a new scene
   - Use edit_scene with regenerate_from_sources=True
   - Update the scene's character_ids to include the new character
   - Write a composition prompt that includes ALL characters (existing + new)

## Important: Cascading Edits (SEQUENTIAL - ONE TOOL AT A TIME)
- When user edits a character or background, you must update scenes containing them
- **CRITICAL: Call only ONE tool at a time.** Wait for each tool to complete before calling the next.
- Sequence: First edit_character/edit_background → wait for result → then edit_scene for each affected scene
- Do NOT call multiple tools in the same response - the scene edit needs the updated character/background image
- Example: User says "make the character's shirt red" → call edit_character ONLY, then in next turn call edit_scene

## edit_scene: regenerate_from_sources parameter
- **regenerate_from_sources=True**: Use after editing a character or background. This sends ONLY the character/background images to Nano Banana (NOT the old scene).
  - **CRITICAL**: Write a FULL scene composition prompt as if creating a new scene!
  - Do NOT write "regenerate" or "update" - Nano Banana has no memory of the previous scene
  - Write: "Naturally integrate this character into this environment at proper scale. The character should be walking down the street..."
  - NOT: "Regenerate the scene to show the character with..."
- **regenerate_from_sources=False**: Use for direct scene edits (like "move character to the left"). This edits the existing scene image.

## Edit Priority
- Prefer editing the source element (character/background) over editing scenes directly
- If user asks to change something in a scene (e.g., "add more trees to the scene"), edit the background first, then edit the scene
- Only edit a scene directly if the user wants to change composition (e.g., "move the character to the left", "change the character's pose in this scene")

## Response Style
- Be friendly and encouraging
- Describe what you're creating before calling tools
- After creation, summarize what was made
- Suggest next steps""")

    response = await model_with_tools.ainvoke([
        system_message,
        *state["messages"],
    ], config)

    # Check if we need to route to tool node
    tool_calls = getattr(response, "tool_calls", None)
    if tool_calls:
        # Check if any tool call is a backend tool
        for tool_call in tool_calls:
            if tool_call.get("name") in backend_tool_names:
                return Command(
                    goto="tool_node",
                    update={"messages": [response], "apiKey": api_key}
                )

    # No backend tool calls, end the conversation turn
    return Command(
        goto=END,
        update={"messages": [response]}
    )


async def process_tool_results(state: AgentState, config: RunnableConfig) -> Command[Literal["chat_node"]]:
    """Process tool results and update state with new artifacts."""
    import json

    # Get the messages
    messages = state["messages"]
    new_characters = list(state.get("characters", []))
    new_backgrounds = list(state.get("backgrounds", []))
    new_scenes = list(state.get("scenes", []))

    # Look for tool messages with results
    for msg in messages:
        if hasattr(msg, "name") and hasattr(msg, "content"):
            tool_name = msg.name
            try:
                # Parse the tool result
                if isinstance(msg.content, str):
                    result = json.loads(msg.content)
                else:
                    result = msg.content

                # Update appropriate collection
                if tool_name == "create_character" and isinstance(result, dict) and "id" in result:
                    if not any(c["id"] == result["id"] for c in new_characters):
                        new_characters.append(result)
                elif tool_name == "create_background" and isinstance(result, dict) and "id" in result:
                    if not any(b["id"] == result["id"] for b in new_backgrounds):
                        new_backgrounds.append(result)
                elif tool_name == "create_scene" and isinstance(result, dict) and "id" in result:
                    if not any(s["id"] == result["id"] for s in new_scenes):
                        new_scenes.append(result)
                # Handle edit tools - update existing items
                elif tool_name == "edit_character" and isinstance(result, dict) and "id" in result and not result.get("error"):
                    for i, c in enumerate(new_characters):
                        if c["id"] == result["id"]:
                            new_characters[i] = result
                            break
                elif tool_name == "edit_background" and isinstance(result, dict) and "id" in result and not result.get("error"):
                    for i, b in enumerate(new_backgrounds):
                        if b["id"] == result["id"]:
                            new_backgrounds[i] = result
                            break
                elif tool_name == "edit_scene" and isinstance(result, dict) and "id" in result and not result.get("error"):
                    for i, s in enumerate(new_scenes):
                        if s["id"] == result["id"]:
                            new_scenes[i] = result
                            break

            except (json.JSONDecodeError, TypeError):
                pass  # Not a JSON result, skip

    return Command(
        goto="chat_node",
        update={
            "characters": new_characters,
            "backgrounds": new_backgrounds,
            "scenes": new_scenes,
        }
    )


# === Build the graph ===

workflow = StateGraph(AgentState)

# Add nodes
workflow.add_node("chat_node", chat_node)
workflow.add_node("tool_node", ToolNode(tools=backend_tools))
workflow.add_node("process_results", process_tool_results)

# Set entry point
workflow.set_entry_point("chat_node")

# Add edges
workflow.add_edge("tool_node", "process_results")

# Compile the graph
graph = workflow.compile()
