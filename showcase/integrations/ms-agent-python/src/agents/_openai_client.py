"""Keep Luna tool calls on the Chat Completions path supported by OpenAI."""

from agent_framework_openai import (
    OpenAIChatCompletionClient as _OpenAIChatCompletionClient,
)


class OpenAIChatCompletionClient(_OpenAIChatCompletionClient):
    def _prepare_options(self, messages, options):
        params = super()._prepare_options(messages, options)
        if params.get("model") == "gpt-6-luna":
            params["reasoning_effort"] = "none"
        return params
