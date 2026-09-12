"""Resolve private registry configuration without a second authenticated transport."""

import math
import os
from collections.abc import Mapping
from dataclasses import dataclass

from copilotkit_intelligence import Intelligence, LearnedSkillsError


@dataclass(frozen=True, slots=True)
class Config:
    client: Intelligence
    container_id: str
    revision: str | None
    freshness_window: float
    request_timeout: float
    debug: bool
    owns_client: bool


def resolve_config(
    *,
    client: Intelligence | None = None,
    api_key: str | None = None,
    api_url: str | None = None,
    container_id: str | None = None,
    revision: str | None = None,
    freshness_window: float = 5,
    request_timeout: float = 5,
    debug: bool = False,
    environment: Mapping[str, str] | None = None,
) -> Config:
    """Explicit values win; injected clients supply all connection configuration."""
    env = os.environ if environment is None else environment
    try:
        container_id = (
            container_id
            if container_id is not None
            else env.get("CPK_INTELLIGENCE_LEARNING_CONTAINER_ID")
        )
        revision = revision if revision is not None else env.get("CPK_INTELLIGENCE_SKILLS_REVISION")
        if (
            not isinstance(container_id, str)
            or not container_id.strip()
            or (revision is not None and (not isinstance(revision, str) or not revision))
            or type(freshness_window) not in (int, float)
            or not math.isfinite(freshness_window)
            or freshness_window < 0
            or type(request_timeout) not in (int, float)
            or not math.isfinite(request_timeout)
            or request_timeout <= 0
            or type(debug) is not bool
        ):
            raise LearnedSkillsError("INVALID_CONFIG", False)
        owns_client = client is None
        if client is None:
            key = api_key if api_key is not None else env.get("CPK_INTELLIGENCE_API_KEY")
            endpoint = api_url if api_url is not None else env.get("INTELLIGENCE_API_URL")
            if not isinstance(key, str) or not key.strip():
                raise LearnedSkillsError("INVALID_CONFIG", False)
            client = (
                Intelligence(api_key=key, api_url=endpoint)
                if endpoint is not None
                else Intelligence(api_key=key)
            )
        elif not callable(getattr(client, "get_learned_skills_snapshot", None)):
            raise LearnedSkillsError("INVALID_CONFIG", False)
        return Config(
            client, container_id, revision, freshness_window, request_timeout, debug, owns_client
        )
    except LearnedSkillsError:
        raise
    except Exception as error:
        raise LearnedSkillsError("INVALID_CONFIG", False, error) from None
