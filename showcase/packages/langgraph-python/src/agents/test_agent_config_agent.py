"""Unit tests for agent_config_agent's prompt builder + defensive defaults."""

from src.agents.agent_config_agent import (
    DEFAULT_EXPERTISE,
    DEFAULT_RESPONSE_LENGTH,
    DEFAULT_TONE,
    build_system_prompt,
    read_properties,
)


def test_read_properties_returns_defaults_when_missing():
    result = read_properties(None)
    assert result == {
        "tone": DEFAULT_TONE,
        "expertise": DEFAULT_EXPERTISE,
        "response_length": DEFAULT_RESPONSE_LENGTH,
    }


def test_read_properties_returns_defaults_when_configurable_missing():
    result = read_properties({})
    assert result == {
        "tone": DEFAULT_TONE,
        "expertise": DEFAULT_EXPERTISE,
        "response_length": DEFAULT_RESPONSE_LENGTH,
    }


def test_read_properties_returns_defaults_when_properties_missing():
    result = read_properties({"configurable": {}})
    assert result == {
        "tone": DEFAULT_TONE,
        "expertise": DEFAULT_EXPERTISE,
        "response_length": DEFAULT_RESPONSE_LENGTH,
    }


def test_read_properties_accepts_valid_values():
    result = read_properties(
        {
            "configurable": {
                "properties": {
                    "tone": "enthusiastic",
                    "expertise": "expert",
                    "responseLength": "detailed",
                }
            }
        }
    )
    assert result == {
        "tone": "enthusiastic",
        "expertise": "expert",
        "response_length": "detailed",
    }


def test_read_properties_rejects_invalid_tone_to_default():
    result = read_properties(
        {"configurable": {"properties": {"tone": "sinister"}}}
    )
    assert result["tone"] == DEFAULT_TONE


def test_read_properties_rejects_invalid_expertise_to_default():
    result = read_properties(
        {"configurable": {"properties": {"expertise": "ninja"}}}
    )
    assert result["expertise"] == DEFAULT_EXPERTISE


def test_read_properties_rejects_invalid_length_to_default():
    result = read_properties(
        {"configurable": {"properties": {"responseLength": "epic"}}}
    )
    assert result["response_length"] == DEFAULT_RESPONSE_LENGTH


def test_read_properties_mixes_valid_and_invalid():
    result = read_properties(
        {
            "configurable": {
                "properties": {
                    "tone": "casual",
                    "expertise": "unknown",
                    "responseLength": "detailed",
                }
            }
        }
    )
    assert result == {
        "tone": "casual",
        "expertise": DEFAULT_EXPERTISE,
        "response_length": "detailed",
    }


def test_build_system_prompt_mentions_each_axis():
    prompt = build_system_prompt("casual", "expert", "detailed")
    assert "Tone:" in prompt
    assert "Expertise level:" in prompt
    assert "Response length:" in prompt
    assert "friendly" in prompt.lower()
    assert "technical fluency" in prompt.lower()
    assert "multiple paragraphs" in prompt.lower()


def test_build_system_prompt_professional_beginner_concise():
    prompt = build_system_prompt("professional", "beginner", "concise")
    assert "neutral, precise language" in prompt.lower()
    assert "assume no prior knowledge" in prompt.lower()
    assert "1-3 sentences" in prompt.lower()


def test_build_system_prompt_enthusiastic_intermediate_concise():
    prompt = build_system_prompt("enthusiastic", "intermediate", "concise")
    assert "upbeat" in prompt.lower()
    assert "specialized terms" in prompt.lower()
    assert "1-3 sentences" in prompt.lower()
