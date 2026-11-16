"""Exercise Luna against the real pinned SDK without network requests."""

from agents._openai_models import OpenAI, OpenAIResponses


def test_chat_model_supports_tools_without_reasoning():
    llm = OpenAI(model="gpt-6-luna", api_key="test-only", max_tokens=40)
    assert llm.metadata.is_chat_model
    assert llm.metadata.is_function_calling_model
    assert llm.metadata.context_window == 1_050_000
    params = llm._get_model_kwargs()
    assert params["reasoning_effort"] == "none"
    assert params["max_completion_tokens"] == 40
    assert "max_tokens" not in params
    assert llm._tokenizer is not None


def test_responses_preserves_reasoning_and_removes_sampling():
    reasoning = {"effort": "medium", "summary": "detailed"}
    llm = OpenAIResponses(
        model="gpt-6-luna",
        api_key="test-only",
        reasoning_options=reasoning,
        additional_kwargs={"reasoning": reasoning},
    )
    assert llm.metadata.is_function_calling_model
    assert llm.metadata.context_window == 1_050_000
    params = llm._get_model_kwargs()
    assert params["reasoning"] == reasoning
    assert "temperature" not in params
    assert "top_p" not in params
    assert llm._tokenizer is not None


def test_custom_legacy_model_keeps_sdk_behavior():
    llm = OpenAI(model="gpt-4o", api_key="test-only")
    assert llm.metadata.context_window == 128_000
    assert "reasoning_effort" not in llm._get_model_kwargs()
