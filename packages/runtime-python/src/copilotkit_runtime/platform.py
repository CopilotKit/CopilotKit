"""Authenticated Intelligence HTTP transport."""

from typing import Any
from urllib.parse import quote

import httpx

from .models import Json, PlatformError, RuntimeConfig


def segment(value: str) -> str:
    """Encode an opaque identifier as one URL path segment."""
    return quote(value, safe="")


class Platform:
    """Use one pooled client with no automatic non-idempotent HTTP retries."""

    def __init__(self, config: RuntimeConfig, client: httpx.AsyncClient) -> None:
        self.config = config
        self.client = client

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
            response = await self.client.request(
                method,
                self.config.api_url.rstrip("/") + path,
                json=body,
                params=query,
                headers={
                    "Authorization": f"Bearer {self.config.api_key}",
                    "Content-Type": "application/json",
                    **(headers or {}),
                },
                timeout=self.config.request_timeout,
            )
        except httpx.HTTPError as error:
            raise PlatformError(502, "Intelligence connection failed") from error
        if not 200 <= response.status_code < 300:
            raise PlatformError(response.status_code, "Intelligence request rejected")
        if not response.content:
            return None
        try:
            return response.json()
        except ValueError as error:
            raise PlatformError(502, "Invalid Intelligence response") from error

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
