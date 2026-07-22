"""Immutable rendering of fully verified generic-SDK skill descriptors."""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any

from copilotkit import IntelligenceSkillSet


MAXIMUM_SKILLS = 128
MAXIMUM_SKILL_BYTES = 262_144
MAXIMUM_CONTEXT_BYTES = 1_048_576


class AdapterError(RuntimeError):
    """Canonical adapter-local failure without a wire-protocol dependency."""

    def __init__(
        self,
        message: str,
        *,
        code: str,
        category: str,
        retryable: bool = False,
        status: int | None = None,
        request_id: str | None = None,
        trace_id: str | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.category = category
        self.retryable = retryable
        self.status = status
        self.request_id = request_id
        self.trace_id = trace_id


@dataclass(frozen=True)
class RenderedSkill:
    """One deterministic native instruction value in Registry order."""

    position: int
    name: str
    text: str
    byte_length: int
    skill_id: str
    version_id: str
    description: str | None
    kind: str = "instruction"

    def as_native(self) -> dict[str, Any]:
        """Return the byte-for-byte cross-runtime semantic record."""

        return {
            "position": self.position,
            "kind": self.kind,
            "name": self.name,
            "text": self.text,
            "byteLength": self.byte_length,
            "skillId": self.skill_id,
            "versionId": self.version_id,
            "description": self.description,
        }


def _failure(message: str, code: str, category: str) -> AdapterError:
    return AdapterError(message, code=code, category=category)


def _contains_disabled_script(descriptor: Any) -> bool:
    for file in descriptor.manifest.files:
        normalized = unicodedata.normalize("NFC", file.path)
        parts = PurePosixPath(normalized).parts
        if file.role.casefold() == "script":
            return True
        if parts and parts[0].casefold() == "scripts":
            return True
    return False


def render_verified_skills(
    skill_set: IntelligenceSkillSet,
    *,
    maximum_skills: int = MAXIMUM_SKILLS,
    maximum_skill_bytes: int = MAXIMUM_SKILL_BYTES,
    maximum_context_bytes: int = MAXIMUM_CONTEXT_BYTES,
) -> tuple[RenderedSkill, ...]:
    """Render a complete set only from immutable verified descriptors."""

    descriptors = skill_set.skill_descriptors
    if skill_set.skills and not descriptors:
        raise _failure(
            "The generic SDK did not provide verified skill descriptors",
            "INTELLIGENCE_ADAPTER_UNSUPPORTED_SDK_PROJECTION",
            "validation",
        )
    if len(descriptors) > maximum_skills:
        raise _failure(
            "The verified Registry set exceeds the adapter skill limit",
            "INTELLIGENCE_ADAPTER_TOO_MANY_SKILLS",
            "validation",
        )
    if any(_contains_disabled_script(descriptor) for descriptor in descriptors):
        raise _failure(
            "Executable skill artifacts are disabled by this adapter",
            "INTELLIGENCE_ADAPTER_SCRIPT_DISABLED",
            "validation",
        )

    rendered: list[RenderedSkill] = []
    aggregate = 0
    for expected_position, descriptor in enumerate(descriptors):
        if descriptor.position != expected_position:
            raise _failure(
                "Verified skill descriptor order is not contiguous",
                "INTELLIGENCE_ADAPTER_UNSUPPORTED_SDK_PROJECTION",
                "validation",
            )
        path = descriptor.directory / "SKILL.md"
        try:
            contents = path.read_bytes()
        except OSError as error:
            failure = _failure(
                "A verified SKILL.md file could not be read",
                "INTELLIGENCE_ADAPTER_INVALID_UTF8",
                "integrity",
            )
            raise failure from error
        if len(contents) > maximum_skill_bytes:
            raise _failure(
                "A verified SKILL.md exceeds the adapter byte limit",
                "INTELLIGENCE_ADAPTER_SKILL_TOO_LARGE",
                "validation",
            )
        aggregate += len(contents)
        if aggregate > maximum_context_bytes:
            raise _failure(
                "The rendered skill set exceeds the adapter context limit",
                "INTELLIGENCE_ADAPTER_CONTEXT_TOO_LARGE",
                "validation",
            )
        try:
            text = contents.decode("utf-8", errors="strict")
        except UnicodeDecodeError as error:
            failure = _failure(
                "A verified SKILL.md is not strict UTF-8",
                "INTELLIGENCE_ADAPTER_INVALID_UTF8",
                "integrity",
            )
            raise failure from error
        rendered.append(
            RenderedSkill(
                position=descriptor.position,
                name=descriptor.name,
                text=text,
                byte_length=len(contents),
                skill_id=descriptor.skill_id,
                version_id=descriptor.version_id,
                description=descriptor.description,
            )
        )
    return tuple(rendered)
