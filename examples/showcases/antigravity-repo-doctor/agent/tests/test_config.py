import pytest
from pydantic import ValidationError

from repo_doctor.config import DEFAULT_GEMINI_MODEL, Settings


@pytest.fixture(autouse=True)
def _isolated_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("GEMINI_API_KEY", "GEMINI_MODEL", "GOOGLE_GEMINI_BASE_URL", "AGENT_PORT", "PORT"):
        monkeypatch.delenv(name, raising=False)


def _settings(**values: object) -> Settings:
    return Settings(_env_file=None, **values)  # type: ignore[call-arg]


def test_a_key_is_required() -> None:
    with pytest.raises(ValidationError, match="gemini_api_key"):
        _settings()


def test_defaults() -> None:
    settings = _settings(gemini_api_key="k")

    assert settings.gemini_api_key.get_secret_value() == "k"
    assert settings.gemini_model == DEFAULT_GEMINI_MODEL
    assert settings.google_gemini_base_url is None
    assert (settings.agent_host, settings.agent_port) == ("127.0.0.1", 8000)


def test_cloud_run_port_does_not_move_the_agent(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PORT", "8080")

    assert _settings(gemini_api_key="k").agent_port == 8000


def test_model_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_MODEL", "gemini-3.8-flash")

    assert _settings(gemini_api_key="k").gemini_model == "gemini-3.8-flash"


def test_blank_directories_are_rejected() -> None:
    with pytest.raises(ValidationError, match="absolute path"):
        _settings(gemini_api_key="k", workspace_root="")


def test_thinking_level(monkeypatch: pytest.MonkeyPatch) -> None:
    from google.antigravity.models import ThinkingLevel

    from repo_doctor.agent import _endpoint

    monkeypatch.delenv("GEMINI_THINKING_LEVEL", raising=False)
    assert _settings(gemini_api_key="k").gemini_thinking_level is None
    assert _endpoint(_settings(gemini_api_key="k")) is None

    monkeypatch.setenv("GEMINI_THINKING_LEVEL", " Low ")
    settings = _settings(gemini_api_key="k")
    endpoint = _endpoint(settings)
    assert endpoint is not None and endpoint.base_url is None
    assert endpoint.options is not None and endpoint.options.thinking_level == ThinkingLevel.LOW

    with pytest.raises(ValidationError):
        _settings(gemini_api_key="k", gemini_thinking_level="extreme")
