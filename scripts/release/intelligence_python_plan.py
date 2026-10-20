"""Plan, build, and publish Intelligence Python packages in dependency order."""

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import urlopen

import tomllib

PACKAGE_PATHS = (
    "packages/runtime-python",
    "packages/intelligence-langgraph-python",
    "packages/intelligence-adk-python",
)


def expected_files(name: str, version: str) -> set[str]:
    distribution = name.replace("-", "_")
    return {
        f"{distribution}-{version}-py3-none-any.whl",
        f"{distribution}-{version}.tar.gz",
    }


def release_files(name: str, version: str) -> set[str]:
    url = f"https://pypi.org/pypi/{name}/{version}/json"
    try:
        with urlopen(url, timeout=15) as response:
            return {item["filename"] for item in json.load(response)["urls"]}
    except HTTPError as error:
        if error.code == 404:
            return set()
        raise


def plan_releases(root: Path) -> list[dict[str, str | bool]]:
    plan = []
    for package_path in PACKAGE_PATHS:
        pyproject = root / package_path / "pyproject.toml"
        project = tomllib.loads(pyproject.read_text())["project"]
        name = project["name"]
        version = project["version"]
        plan.append(
            {
                "path": package_path,
                "name": name,
                "version": version,
                "publish": not expected_files(name, version)
                <= release_files(name, version),
            }
        )
    return plan


def build_releases(plan: list[dict[str, str | bool]], dist_dir: Path) -> None:
    for package in plan:
        if package["publish"]:
            subprocess.run(
                [
                    "uv",
                    "build",
                    str(package["path"]),
                    "--out-dir",
                    str(dist_dir / str(package["name"])),
                ],
                check=True,
            )


def publish_releases(
    plan: list[dict[str, str | bool]],
    dist_dir: Path,
    selected_package: str | None = None,
) -> None:
    if selected_package is not None:
        plan = [package for package in plan if package["name"] == selected_package]
        if not plan:
            raise ValueError(f"unknown package: {selected_package}")
    artifacts = {}
    for package in plan:
        if package["publish"]:
            name = str(package["name"])
            version = str(package["version"])
            files = [
                dist_dir / name / filename
                for filename in sorted(expected_files(name, version))
            ]
            missing = [file.name for file in files if not file.is_file()]
            if missing:
                raise FileNotFoundError(
                    f"Missing artifacts for {name}: {', '.join(missing)}"
                )
            artifacts[str(package["name"])] = files

    for package in plan:
        if not package["publish"]:
            continue
        name = str(package["name"])
        version = str(package["version"])
        expected = expected_files(name, version)
        if not expected <= release_files(name, version):
            subprocess.run(
                [
                    "uv",
                    "publish",
                    "--trusted-publishing",
                    "always",
                    "--check-url",
                    "https://pypi.org/simple/",
                    *artifacts[name],
                ],
                check=True,
            )
        for attempt in range(18):
            if expected <= release_files(name, version):
                print(f"Confirmed {name}=={version} on PyPI", flush=True)
                break
            if attempt == 17:
                raise RuntimeError(f"{name}=={version} did not appear on PyPI")
            time.sleep(10)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("plan", "build", "publish"))
    parser.add_argument("--plan-file", type=Path, default=Path("release-plan.json"))
    parser.add_argument(
        "--dist-dir", type=Path, default=Path("intelligence-python-dist")
    )
    parser.add_argument("--package")
    args = parser.parse_args()
    if args.command == "plan":
        json.dump(
            plan_releases(Path(__file__).resolve().parents[2]), sys.stdout, indent=2
        )
        sys.stdout.write("\n")
    else:
        plan = json.loads(args.plan_file.read_text())
        if args.command == "build":
            build_releases(plan, args.dist_dir)
        else:
            publish_releases(plan, args.dist_dir, args.package)
