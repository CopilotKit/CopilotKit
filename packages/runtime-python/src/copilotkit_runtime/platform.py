"""Authenticated Intelligence HTTP transport."""

from typing import Any
from urllib.parse import quote

import httpx

from copilotkit_intelligence import Intelligence, IntelligenceError

from .models import Json, PlatformError, RuntimeConfig


def segment(value: str) -> str:
    """Encode an opaque identifier as one URL path segment."""
    return quote(value, safe="")


class Platform:
    """Use one pooled client with no automatic non-idempotent HTTP retries."""

    def __init__(
        self,
        config: RuntimeConfig,
        client: httpx.AsyncClient,
        intelligence: Intelligence | None = None,
    ) -> None:
        self.config = config
        self.client = client
        self.intelligence = intelligence or Intelligence(
            api_key=config.api_key,
            api_url=config.api_url,
            runner_url=config.runner_url,
            client_url=config.client_url,
            request_timeout=config.request_timeout,
            http_client=client,
        )

    async def request(
        self,
        method: str,
        path: str,
        body: Json | None = None,
        query: Json | None = None,
        headers: dict[str, str] | None = None,
    ) -> Any:
        """Call Intelligence, retaining status but never exposing upstream bodies."""
        try:
            return await self.intelligence._request(method, path, body, query, headers)
        except IntelligenceError as error:
            raise PlatformError(error.status, str(error)) from error

    async def get_or_create_thread(self, body: Json) -> None:
        """Read before creating and resolve a concurrent create through a scoped read."""
        path = "/api/threads/" + segment(body["threadId"])
        query = {"userId": body["userId"]}
        try:
            await self.request("GET", path, query=query)
            return
        except PlatformError as error:
            if error.status != 404:
                raise
        try:
            await self.request("POST", "/api/threads", body)
        except PlatformError as error:
            if error.status != 409:
                raise
            await self.request("GET", path, query=query)
