"""Verify separate wheels can coexist and uninstall without damaging one another."""

import hashlib
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PACKAGES = [
    "runtime-python",
    "intelligence-langgraph-python",
    "intelligence-adk-python",
]

with tempfile.TemporaryDirectory(prefix="learned-skill-wheel-install-") as directory:
    temporary = Path(directory)
    feed = temporary / "feed"
    for name in PACKAGES:
        subprocess.run(
            ["uv", "build", "--wheel", "--out-dir", str(feed)],
            cwd=ROOT / "packages" / name,
            check=True,
        )
    wheels = sorted(feed.glob("*.whl"))
    assert len(wheels) == 3
    core_hashes = []
    for wheel in wheels:
        if "intelligence_runtime" in wheel.name:
            continue
        with zipfile.ZipFile(wheel) as archive:
            core = {
                name.split("/_delivery/", 1)[1]: hashlib.sha256(
                    archive.read(name)
                ).hexdigest()
                for name in archive.namelist()
                if "/_delivery/" in name and name.endswith(".py")
            }
            assert core, "Adapter wheel did not include its private core"
            assert not any(name.startswith("_delivery/") for name in archive.namelist())
            core_hashes.append(core)
    assert len(core_hashes) == 2 and core_hashes[0] == core_hashes[1], (
        "Adapter core copies differ"
    )
    environment = temporary / "venv"
    subprocess.run(
        ["uv", "venv", "--python", sys.executable, str(environment)], check=True
    )
    python = environment / "bin" / "python"
    subprocess.run(
        ["uv", "pip", "install", "--python", str(python), *map(str, wheels)], check=True
    )

    def run(source: str) -> None:
        subprocess.run([str(python), "-I", "-c", source], cwd=temporary, check=True)

    run(
        "from copilotkit_intelligence_langgraph._delivery import registry as l; from copilotkit_intelligence_adk._delivery import registry as a; assert l.Registry is not a.Registry"
    )
    for removed, retained in [("langgraph", "adk"), ("adk", "langgraph")]:
        subprocess.run(
            [
                "uv",
                "pip",
                "uninstall",
                "--python",
                str(python),
                "copilotkit-intelligence-" + removed,
            ],
            check=True,
        )
        run(
            f"import importlib.util; import copilotkit_intelligence_{retained}; assert importlib.util.find_spec('copilotkit_intelligence_{removed}') is None"
        )
        wheel = next(path for path in wheels if "intelligence_" + removed in path.name)
        subprocess.run(
            ["uv", "pip", "install", "--python", str(python), "--no-deps", str(wheel)],
            check=True,
        )
    print("Independent Python wheels coexist and survive either adapter uninstall.")
