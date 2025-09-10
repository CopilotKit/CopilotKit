#!/usr/bin/env python3
"""
CopilotKit Dependency Synchronization Script
Ensures all examples use standardized dependency versions from the main SDK.

Usage:
    python sync-deps.py [example-path]
    python sync-deps.py --all  # Update all examples
"""

import os
import sys
import toml
from pathlib import Path

# Canonical versions from main SDK
CANONICAL_VERSIONS = {
    "python": ">=3.10,<3.13",  # Compatible with CopilotKit requirement
    "copilotkit": "0.1.49",
    "langchain": "0.3.21",
    "langgraph": "0.3.18",
    "langsmith": "0.3.18",
    "openai": "^1.68.2",
    "fastapi": "^0.115.5",
    "uvicorn": "^0.29.0",
    "python-dotenv": "^1.0.0",
    "crewai": "0.118.0"  # For CrewAI examples
}

REQUIREMENTS_TEMPLATE = """# CopilotKit standardized dependencies for pip compatibility
# Generated from pyproject.toml - keep these versions synchronized

copilotkit==0.1.49
langchain==0.3.21
langgraph==0.3.18
langsmith==0.3.18
openai>=1.68.2,<2.0.0
fastapi>=0.115.5,<1.0.0
uvicorn>=0.29.0,<1.0.0
python-dotenv>=1.0.0,<2.0.0
"""

def update_pyproject(pyproject_path):
    """Update pyproject.toml with canonical versions while preserving existing config."""
    if not pyproject_path.exists():
        print(f"Skipping {pyproject_path} - file not found")
        return False

    try:
        with open(pyproject_path, 'r') as f:
            data = toml.load(f)

        deps = data.get('tool', {}).get('poetry', {}).get('dependencies', {})
        updated = False

        # Update only the canonical dependencies, preserve others
        for dep, version in CANONICAL_VERSIONS.items():
            if dep in deps and deps[dep] != version:
                print(f"Updating {dep}: {deps[dep]} -> {version}")
                deps[dep] = version
                updated = True

        # Preserve existing sections like scripts, dev-dependencies, etc.
        # Only update the dependencies section

        if updated:
            with open(pyproject_path, 'w') as f:
                toml.dump(data, f)
            print(f"✅ Updated {pyproject_path} (preserved existing config)")
        else:
            print(f"✅ {pyproject_path} already up to date")

        return True

    except Exception as e:
        print(f"❌ Error updating {pyproject_path}: {e}")
        return False

def create_requirements_txt(requirements_path, has_crewai=False):
    """Create or update requirements.txt for pip compatibility."""
    template = REQUIREMENTS_TEMPLATE
    if has_crewai:
        template += "crewai==0.118.0\n"

    with open(requirements_path, 'w') as f:
        f.write(template)
    print(f"✅ Created {requirements_path}")

def main():
    if len(sys.argv) < 2:
        print("Usage: python sync-deps.py [example-path] or --all")
        return

    examples_root = Path("../../../examples")

    if sys.argv[1] == "--all":
        # Update all Python examples
        for example_dir in examples_root.glob("*/agent*/"):
            pyproject_path = example_dir / "pyproject.toml"
            requirements_path = example_dir / "requirements.txt"

            if pyproject_path.exists():
                update_pyproject(pyproject_path)
                has_crewai = "crewai" in example_dir.name
                create_requirements_txt(requirements_path, has_crewai)
    else:
        # Update specific example
        example_path = Path(sys.argv[1])
        pyproject_path = example_path / "pyproject.toml"
        requirements_path = example_path / "requirements.txt"

        if pyproject_path.exists():
            update_pyproject(pyproject_path)
            has_crewai = "crewai" in str(example_path)
            create_requirements_txt(requirements_path, has_crewai)

if __name__ == "__main__":
    main()