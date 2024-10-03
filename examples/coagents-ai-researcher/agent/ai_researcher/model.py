"""
This module provides a function to get a model based on the configuration.
"""
import os
from langchain_openai import ChatOpenAI
from langchain_anthropic import ChatAnthropic


def get_model():
    """
    Get a model based on the environment variable.
    """
    model = os.getenv("MODEL", "openai")


    if model == "openai":
        return ChatOpenAI(temperature=0, model_name="gpt-4o")
    if model == "anthropic":
        return ChatAnthropic(temperature=0, model_name="claude-3-5-sonnet-20240620")

    raise ValueError("Invalid model specified")
