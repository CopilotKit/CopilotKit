"""Prove the sdist builds independently and the wheel owns its private namespace."""

import os
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="copilotkit-adk-distribution-") as directory:
    temporary = Path(directory)
    artifacts = temporary / "artifacts"
    subprocess.run(["uv", "build", "--sdist", "--out-dir", str(artifacts)], cwd=root, check=True)
    archive = next(artifacts.glob("*.tar.gz"))
    extracted = temporary / "source"
    with tarfile.open(archive) as source:
        source.extractall(extracted, filter="data")
    standalone = next(extracted.iterdir())
    subprocess.run(
        ["uv", "build", "--wheel", "--out-dir", str(artifacts)], cwd=standalone, check=True
    )
    wheel = next(artifacts.glob("*.whl"))
    with zipfile.ZipFile(wheel) as package:
        names = package.namelist()
        assert "copilotkit_intelligence_adk/_delivery/registry.py" in names
        assert "copilotkit_intelligence_adk/_delivery/snapshot.py" in names
        assert not any(name.startswith("_delivery/") or "/__pycache__/" in name for name in names)
        package.extractall(temporary / "installed")
    # Use the dependency environment but run outside the checkout. The extracted
    # wheel takes precedence over the editable source through PYTHONPATH.
    env = {**os.environ, "PYTHONPATH": str(temporary / "installed")}
    subprocess.run(
        [
            sys.executable,
            "-c",
            "from pathlib import Path; import copilotkit_intelligence_adk as p; from copilotkit_intelligence_adk._delivery import registry; assert '_delivery' in registry.__name__; assert 'installed' in str(Path(p.__file__)); assert callable(p.SkillRegistry); assert callable(p.SkillToolset)",
        ],
        cwd=temporary,
        env=env,
        check=True,
    )
    print("Standalone sdist build and private wheel import passed")
