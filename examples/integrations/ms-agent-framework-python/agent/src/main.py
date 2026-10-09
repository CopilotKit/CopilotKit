from __future__ import annotations

import os
from urllib.parse import urlparse

import uvicorn
from agent_framework import SupportsChatGetResponse
from agent_framework.openai import OpenAIChatClient, OpenAIChatCompletionClient
from agent_framework_ag_ui import add_agent_framework_fastapi_endpoint
from azure.identity import DefaultAzureCredential
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from agent import create_agent
from model import parse_agent_model

load_dotenv()


# Chat Completions endpoints that Anthropic and Google serve for OpenAI clients.
# Agent Framework's own Anthropic and Gemini clients are still prereleases, so
# the starter reaches those providers through these instead.
_COMPATIBLE_BASE_URLS = {
    "anthropic": "https://api.anthropic.com/v1/",
    "google": "https://generativelanguage.googleapis.com/v1beta/openai/",
}
_API_KEY_VARIABLES = {"anthropic": "ANTHROPIC_API_KEY", "google": "GOOGLE_API_KEY"}


def uses_chat_completions() -> bool:
    """Whether ``OPENAI_BASE_URL`` points at an OpenAI-compatible provider.

    Most compatible providers serve only ``{base}/chat/completions``, not the
    Responses API (which OpenAIChatClient calls), so those get the Chat
    Completions client. OpenAI's own hosts
    (``api.openai.com``, regional ``*.api.openai.com``), Azure OpenAI
    (``*.openai.azure.com``), an unset variable and an unparseable URL keep
    the Responses API. Same rule as the CopilotKit runtime (PE-706).
    """
    base_url = (os.getenv("OPENAI_BASE_URL") or "").strip()
    if not base_url:
        return False
    try:
        hostname = (urlparse(base_url).hostname or "").lower()
    except ValueError:
        return False
    if not hostname:
        return False
    is_openai_host = (
        hostname == "api.openai.com"
        or hostname.endswith(".api.openai.com")
        or hostname.endswith(".openai.azure.com")
    )
    return not is_openai_host


def _openai_client_class() -> type[OpenAIChatClient] | type[OpenAIChatCompletionClient]:
    """The OpenAI client class for the configured endpoint (see uses_chat_completions)."""
    return OpenAIChatCompletionClient if uses_chat_completions() else OpenAIChatClient


def _build_chat_client() -> SupportsChatGetResponse:
    azure_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
    openai_api_key = os.getenv("OPENAI_API_KEY")
    # COPILOTKIT_AGENT_MODEL (e.g. "anthropic:claude-sonnet-4-5") picks the
    # provider and model when Azure OpenAI is not configured; unset, the agent
    # uses OPENAI_CHAT_MODEL_ID or gpt-4o-mini on OpenAI. An OpenAI-compatible
    # provider is openai:<its model id> plus OPENAI_BASE_URL, which the OpenAI
    # clients read themselves (see _openai_client_class for which client).
    agent_model = (os.getenv("COPILOTKIT_AGENT_MODEL") or "").strip()
    if agent_model and not azure_endpoint:
        provider, model = parse_agent_model(agent_model)
        if provider != "openai":
            key_variable = _API_KEY_VARIABLES[provider]
            api_key = os.getenv(key_variable)
            if not api_key:
                raise ValueError(f"Set {key_variable} to use {agent_model}.")
            return OpenAIChatCompletionClient(
                model=model,
                api_key=api_key,
                base_url=_COMPATIBLE_BASE_URLS[provider],
            )
        if not openai_api_key:
            raise ValueError(f"Set OPENAI_API_KEY to use {agent_model}.")
        return _openai_client_class()(model=model, api_key=openai_api_key)

    if not azure_endpoint and not openai_api_key:
        raise ValueError(
            "Set AZURE_OPENAI_ENDPOINT (uses az login unless AZURE_OPENAI_API_KEY is set) or OPENAI_API_KEY."
        )

    try:
        if azure_endpoint:
            azure_api_key = os.getenv("AZURE_OPENAI_API_KEY")
            return OpenAIChatClient(
                model=os.getenv("AZURE_OPENAI_CHAT_DEPLOYMENT_NAME", "gpt-4o-mini"),
                api_key=azure_api_key,
                credential=None if azure_api_key else DefaultAzureCredential(),
                azure_endpoint=azure_endpoint,
            )

        return _openai_client_class()(
            model=os.getenv("OPENAI_CHAT_MODEL_ID", "gpt-4o-mini"),
            api_key=openai_api_key,
        )

    except Exception as exc:  # pragma: no cover
        raise RuntimeError(
            "Unable to initialize the chat client. Double-check your API credentials as documented in README.md."
        ) from exc


chat_client = _build_chat_client()
my_agent = create_agent(chat_client)

app = FastAPI(title="CopilotKit + Microsoft Agent Framework (Python)")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


add_agent_framework_fastapi_endpoint(
    app=app,
    agent=my_agent,
    path="/",
)


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    host = os.getenv("AGENT_HOST", "0.0.0.0")
    port = int(os.getenv("AGENT_PORT", "8000"))
    uvicorn.run("main:app", host=host, port=port, reload=True)
