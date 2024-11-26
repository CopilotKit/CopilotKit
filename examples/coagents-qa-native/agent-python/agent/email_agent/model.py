"""
This module provides a function to get a model based on the configuration.
"""
import os
from langchain_core.language_models.chat_models import BaseChatModel
from email_agent.state import EmailAgentState


def get_model(state: EmailAgentState) -> BaseChatModel:
    """
    Get a model based on the environment variable.
    """

    state_model = state.get("model")
    model = os.getenv("MODEL", state_model)

    print(f"Using model: {model}")

    if model == "openai":
        from langchain_openai import ChatOpenAI # pylint: disable=import-outside-toplevel
        return ChatOpenAI(temperature=0, model="gpt-4o-mini")
    if model == "anthropic":
        from langchain_anthropic import ChatAnthropic # pylint: disable=import-outside-toplevel
        return ChatAnthropic(
            temperature=0, 
            model_name="claude-3-5-sonnet-20240620",
            timeout=None,
            stop=None
        )
    if model == "google_genai":
        from langchain_google_genai import ChatGoogleGenerativeAI # pylint: disable=import-outside-toplevel
        return ChatGoogleGenerativeAI(temperature=0, model="gemini-1.5-pro")

    raise ValueError("Invalid model specified")
