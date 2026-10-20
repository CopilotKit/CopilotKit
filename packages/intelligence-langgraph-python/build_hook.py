"""Vendor shared private source into each artifact without a public core package."""

from pathlib import Path
from shutil import copyfile
from typing import Any

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class DeliveryBuildHook(BuildHookInterface):
    def initialize(self, version: str, build_data: dict[str, Any]) -> None:
        root = Path(self.root)
        source = root / "_vendor" / "_delivery"
        if not source.is_dir():
            source = root.parent / "intelligence-delivery-python-core" / "src" / "_delivery"
        if not (source / "registry.py").is_file():
            raise RuntimeError("Private delivery source is missing from the source distribution")
        target = (
            "_vendor/_delivery"
            if self.target_name == "sdist"
            else "copilotkit_intelligence_langgraph/_delivery"
        )
        if version == "editable":
            generated = root / "src" / "copilotkit_intelligence_langgraph" / "_delivery"
            generated.mkdir(parents=True, exist_ok=True)
            for file in source.glob("*.py"):
                copyfile(file, generated / file.name)
        for file in source.glob("*.py"):
            build_data.setdefault("force_include", {})[str(file)] = f"{target}/{file.name}"
