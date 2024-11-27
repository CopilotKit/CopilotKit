"""
This module provides a function to get a model based on the configuration.
"""
from typing import Any
import os

def get_model(state: Any) -> Any:
    """
    Get a model based on the environment variable.
    """

    model = state.get("model")

    print(f"Using model: {model}")

    if model == "openai":
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(temperature=0, model="gpt-4o")
    if model == "anthropic":
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(temperature=0, model_name="claude-3-5-sonnet-20240620", timeout=None, stop=None)
    if model == "google_genai":
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(temperature=0, model="gemini-1.5-pro")

    raise ValueError("Invalid model specified")
