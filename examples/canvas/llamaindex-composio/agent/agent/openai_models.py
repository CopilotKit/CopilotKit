"""Luna compatibility for LlamaIndex's pinned OpenAI model table."""

import tiktoken
from llama_index.core.base.llms.types import LLMMetadata
from llama_index.llms.openai import OpenAI as SDKOpenAI


class OpenAI(SDKOpenAI):
    @property
    def metadata(self) -> LLMMetadata:
        if self.model != "gpt-6-luna":
            return super().metadata
        return LLMMetadata(
            context_window=1_050_000,
            num_output=self.max_tokens or -1,
            is_chat_model=True,
            is_function_calling_model=True,
            model_name=self.model,
        )

    @property
    def _tokenizer(self):
        if self.model == "gpt-6-luna":
            return tiktoken.get_encoding("o200k_base")
        return super()._tokenizer

    def _get_model_kwargs(self, **kwargs):
        params = super()._get_model_kwargs(**kwargs)
        if self.model == "gpt-6-luna":
            params["reasoning_effort"] = "none"
            if "max_tokens" in params:
                params["max_completion_tokens"] = params.pop("max_tokens")
        return params
