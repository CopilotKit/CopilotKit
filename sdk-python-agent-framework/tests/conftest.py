from __future__ import annotations

import asyncio
import hashlib
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from copilotkit import (
    IntelligenceSkill,
    IntelligenceSkillDescriptor,
    IntelligenceSkillFileDescriptor,
    IntelligenceSkillManifestDescriptor,
    IntelligenceSkillSet,
)


CONTAINER_ID = "55555555-5555-4555-8555-555555555555"


class FakeClock:
    def __init__(self, seconds: float = 0.0) -> None:
        self.seconds = seconds

    def __call__(self) -> float:
        return self.seconds


class FakeSkillsClient:
    def __init__(self) -> None:
        self.get_outcomes: list[Any] = []
        self.cached_outcomes: list[Any] = []
        self.get_calls: list[str] = []
        self.cached_calls: list[str] = []

    async def get(self, learning_container_id: str) -> IntelligenceSkillSet:
        self.get_calls.append(learning_container_id)
        return await self._next(self.get_outcomes)

    async def get_cached(self, learning_container_id: str) -> IntelligenceSkillSet:
        self.cached_calls.append(learning_container_id)
        return await self._next(self.cached_outcomes)

    @staticmethod
    async def _next(outcomes: list[Any]) -> Any:
        if not outcomes:
            raise AssertionError("unexpected generic-client call")
        outcome = outcomes.pop(0)
        if isinstance(outcome, asyncio.Future):
            return await outcome
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome


def client(skills: FakeSkillsClient) -> Any:
    return SimpleNamespace(skills=skills)


def skill_set(
    tmp_path: Path,
    *,
    texts: tuple[str, ...] = ("# Skill\n",),
    roles: tuple[str, ...] | None = None,
    paths: tuple[str, ...] | None = None,
    freshness: str = "fresh",
    revoked: bool = False,
    legacy_only: bool = False,
    registry_revision: str = "revision-1",
) -> IntelligenceSkillSet:
    roles = roles or tuple("instruction" for _ in texts)
    paths = paths or tuple("SKILL.md" for _ in texts)
    skills: list[IntelligenceSkill] = []
    descriptors: list[IntelligenceSkillDescriptor] = []
    for position, (text, role, manifest_path) in enumerate(
        zip(texts, roles, paths, strict=True)
    ):
        directory = tmp_path / f"skill-{position}"
        directory.mkdir(parents=True, exist_ok=True)
        contents = text.encode("utf-8")
        (directory / "SKILL.md").write_bytes(contents)
        skill_id = (
            "99999999-9999-4999-8999-999999999999"
            if position == 0
            else f"{position + 1:08d}-9999-4999-8999-999999999999"
        )
        version_id = (
            "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
            if position == 0
            else f"{position + 1:08d}-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        )
        skills.append(IntelligenceSkill(skill_id, version_id, position, directory))
        descriptors.append(
            IntelligenceSkillDescriptor(
                skill_id=skill_id,
                version_id=version_id,
                position=position,
                name="Safe skill" if position == 0 else f"Skill {position}",
                description=None if position == 0 else f"Description {position}",
                directory=directory,
                manifest=IntelligenceSkillManifestDescriptor(
                    agent_skills_profile="agentskills.io/v1",
                    manifest_sha256="a" * 64,
                    files=(
                        IntelligenceSkillFileDescriptor(
                            path=manifest_path,
                            role=role,
                            media_type="text/markdown",
                            byte_length=len(contents),
                            raw_sha256=hashlib.sha256(contents).hexdigest(),
                        ),
                    ),
                ),
            )
        )
    return IntelligenceSkillSet(
        learning_container_id=CONTAINER_ID,
        registry_revision=registry_revision,
        skill_set_hash="b" * 64,
        skills=tuple(skills),
        path=tmp_path,
        freshness=freshness,
        revoked=revoked,
        skill_descriptors=() if legacy_only else tuple(descriptors),
    )
