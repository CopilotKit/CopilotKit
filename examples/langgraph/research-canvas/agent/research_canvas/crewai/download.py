"""
Utility functions for downloading resources.
"""
import aiohttp
import html2text
from typing_extensions import Dict, Any
from copilotkit.crewai import copilotkit_emit_state
from research_canvas.crewai.tools import prepare_state_for_serialization

_RESOURCE_CACHE = {}

def get_resource(url: str):
    """
    Get a resource from the cache.
    """
    return _RESOURCE_CACHE.get(url, "")

_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3" # pylint: disable=line-too-long

async def _download_resource(url: str):
    """
    Download a resource from the internet asynchronously.
    """
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                url,
                headers={"User-Agent": _USER_AGENT},
                timeout=aiohttp.ClientTimeout(total=10)
            ) as response:
                response.raise_for_status()
                html_content = await response.text()
                markdown_content = html2text.html2text(html_content)
                _RESOURCE_CACHE[url] = markdown_content
                return markdown_content
    except Exception as e: # pylint: disable=broad-except
        _RESOURCE_CACHE[url] = "ERROR"
        return f"Error downloading resource: {e}"


async def download_resources(state: Dict[str, Any]):
    """
    Download resources from the internet.
    """
    state["resources"] = state.get("resources", [])
    state["logs"] = state.get("logs", [])
    resources_to_download = []

    logs_offset = len(state["logs"])

    # Find resources that are not downloaded
    for resource in state["resources"]:
        if not get_resource(resource["url"]):
            resources_to_download.append(resource)
            state["logs"].append({
                "message": f"Downloading {resource['url']}",
                "done": False
            })

    # Prepare serializable state and emit to let the UI update
    serializable_state = prepare_state_for_serialization(state)
    await copilotkit_emit_state(serializable_state)

    # Download the resources
    for i, resource in enumerate(resources_to_download):
        await _download_resource(resource["url"])
        state["logs"][logs_offset + i]["done"] = True

        # Prepare serializable state and update UI
        serializable_state = prepare_state_for_serialization(state)
        await copilotkit_emit_state(serializable_state)

def get_resources(state: Dict[str, Any]):
    """
    Get the resources from the state.
    """
    resources = []

    for resource in state["resources"]:
        content = get_resource(resource["url"])
        if content == "ERROR":
            continue
        resources.append({
            **resource,
            "content": content
        })

    return resources
