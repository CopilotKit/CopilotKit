from unittest.mock import AsyncMock

import pytest
from copilotkit_intelligence import Intelligence, LearnedSkillsError

from _delivery.config import resolve_config
from _delivery.registry import Registry


def test_injected_client_is_authoritative_without_connection_env_reads():
    class Environment(dict):
        def get(self, key, default=None):
            if key in ("CPK_INTELLIGENCE_API_KEY", "INTELLIGENCE_API_URL"):
                pytest.fail("read secondary connection configuration")
            return super().get(key, default)

    client = AsyncMock(spec=Intelligence)
    config = resolve_config(
        client=client, environment=Environment(CPK_INTELLIGENCE_LEARNING_CONTAINER_ID="c")
    )
    assert config.client is client and not config.owns_client
    assert config.freshness_window == 5 and config.request_timeout == 5 and not config.debug
    assert not hasattr(config, "api_key")


async def test_explicit_values_override_environment_and_helper_owns_its_client():
    config = resolve_config(
        api_key="explicit",
        api_url="https://self.test/base",
        container_id="explicit-container",
        revision="opaque/+?",
        environment={
            "CPK_INTELLIGENCE_API_KEY": "env",
            "INTELLIGENCE_API_URL": "https://env.test",
            "CPK_INTELLIGENCE_LEARNING_CONTAINER_ID": "env",
            "CPK_INTELLIGENCE_SKILLS_REVISION": "env",
        },
    )
    try:
        assert config.client.api_key == "explicit"
        assert config.client.api_url == "https://self.test/base"
        assert config.container_id == "explicit-container" and config.revision == "opaque/+?"
        assert config.owns_client
    finally:
        await config.client.aclose()


async def test_environment_helper_defaults_and_ownership(monkeypatch):
    monkeypatch.setenv("CPK_INTELLIGENCE_API_KEY", "key")
    monkeypatch.setenv("CPK_INTELLIGENCE_LEARNING_CONTAINER_ID", "c")
    registry = Registry()
    await registry.aclose()
    client = AsyncMock(spec=Intelligence)
    registry = Registry(client=client)
    await registry.aclose()
    client.aclose.assert_not_called()


@pytest.mark.parametrize(
    "options",
    [
        {},
        {"container_id": ""},
        {"container_id": "c", "revision": ""},
        {"container_id": "c", "freshness_window": -1},
        {"container_id": "c", "request_timeout": 0},
        {"container_id": "c", "request_timeout": float("nan")},
        {"container_id": "c", "debug": "yes"},
    ],
)
def test_invalid_behavior_configuration(options):
    with pytest.raises(LearnedSkillsError) as error:
        resolve_config(client=AsyncMock(spec=Intelligence), **options)
    assert error.value.code == "INVALID_CONFIG"


@pytest.mark.parametrize("url", ["file:///tmp", "https://user:pass@test", "https://test?q=secret"])
def test_invalid_helper_endpoint(url):
    with pytest.raises(LearnedSkillsError) as error:
        resolve_config(api_key="key", api_url=url, container_id="c")
    assert error.value.code == "INVALID_CONFIG"
