"""Environment-driven settings, validated once at startup.

The Antigravity harness (a Go subprocess) makes every model call, so the model
settings here are handed to the adapter up front rather than per request. The
model runs on Antigravity's native Gemini path.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# The SDK's own default is gemini-3.8-flash. gemini-3.5-flash handles the
# multi-step fix well at a lower price.
DEFAULT_GEMINI_MODEL = "gemini-3.5-flash"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Model ---------------------------------------------------------------
    gemini_api_key: SecretStr = Field(
        description="Gemini API key from https://aistudio.google.com/apikey"
    )
    gemini_model: str = DEFAULT_GEMINI_MODEL
    google_gemini_base_url: str | None = Field(
        default=None, description="A Gemini-compatible gateway or mock instead of Google's API."
    )
    # How much the model reasons before answering (the SDK's ThinkingLevel).
    # Unset keeps the SDK and model default. Lower is cheaper and faster.
    gemini_thinking_level: Literal["minimal", "low", "medium", "high"] | None = None

    # --- GitHub (optional) -----------------------------------------------------
    # Read-only token for the GitHub REST API reads in `ci_status` only (public
    # repositories need no scopes). Without it the API allows 60 requests an
    # hour per IP. The hardening removes GITHUB_TOKEN from the environment the
    # harness and every shell command inherit, so only this object holds it.
    github_token: SecretStr | None = None

    # --- Harness directories -------------------------------------------------
    # Keep these SHORT. The model copies absolute paths into tool calls, and a
    # long high-entropy path gets mangled; the harness treats that as fatal.
    workspace_root: Path = Path("/tmp/rd/ws")
    save_dir: Path = Path("/tmp/rd/sessions")
    # Local bare repositories that `git_push` pushes to. Pushes never leave the
    # machine: the cloned repo's GitHub remote has its push URL disabled.
    push_root: Path = Path("/tmp/rd/remotes")
    # Each thread's Python venv. Kept on local disk even when WORKSPACE_ROOT is
    # a Cloud Storage volume: an install writes tens of thousands of small
    # files. Deleted when the thread's session closes.
    venv_root: Path = Path("/tmp/rd/venvs")

    # --- Saved workspaces (optional) --------------------------------------------
    # Where each conversation's repo, push remote and harness session are saved
    # so they survive a restart: "gs://bucket" (or a bare bucket name), or
    # "file:///abs/dir" for local tests. Unset keeps everything on local disk.
    workspace_bucket: str | None = None
    # A repo bigger than this (without .venv, node_modules and build output)
    # is not saved; the agent logs a warning and keeps working locally.
    snapshot_max_bytes: int = Field(default=500_000_000, ge=1)
    # uv's package cache (local disk, so memory on Cloud Run) is cleared when it
    # grows past this; installed venvs keep their hard-linked files.
    uv_cache_max_bytes: int = Field(default=6_000_000_000, ge=1)
    # The agent's own uv cache, on the same disk as the venvs so installs
    # hard-link from it. Separate from the user's cache, which is never touched.
    uv_cache_dir: Path = Path("/tmp/rd/uv-cache")

    # --- Limits --------------------------------------------------------------
    max_tool_calls_per_turn: int = Field(default=60, ge=1)
    command_timeout_seconds: int = Field(default=600, ge=10)

    # The agent only needs to be reachable from the Next.js server, which runs
    # next to it (same machine or same container). Not `PORT`: Cloud Run sets
    # that for the public Next.js server.
    agent_host: str = "127.0.0.1"
    agent_port: int = 8000

    @field_validator("github_token", "google_gemini_base_url", "workspace_bucket", mode="before")
    @classmethod
    def _blank_is_unset(cls, value: object) -> object:
        return None if value == "" else value

    @field_validator("gemini_thinking_level", mode="before")
    @classmethod
    def _thinking_level(cls, value: object) -> object:
        if isinstance(value, str):
            value = value.strip().lower()
            return value or None
        return value

    @field_validator("workspace_root", "save_dir", "push_root", "venv_root", "uv_cache_dir")
    @classmethod
    def _absolute(cls, path: Path) -> Path:
        # A blank value in .env would otherwise become ".", the agent's own folder.
        if not path.is_absolute():
            raise ValueError(f"must be an absolute path, got {str(path)!r}")
        return path


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
