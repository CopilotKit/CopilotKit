"""Luna request fields missing from Langroid's generic parameter schema."""

from langroid.language_models.openai_gpt import OpenAICallParams


class LunaCallParams(OpenAICallParams):
    reasoning_effort: str = "none"
