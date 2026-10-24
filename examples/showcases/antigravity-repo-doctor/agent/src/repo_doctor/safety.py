"""Keeps the agent from ever acting as the user on GitHub.

The harness runs shell commands the user approves, and cloned repositories run
their own code (test files, install hooks). Both inherit this process's
environment, so it is shaped once at startup:

* API keys and GitHub tokens are removed.
* git cannot prompt, read the user's git config, use an askpass helper, the SSH
  agent or SSH keys.
* `gh` gets an empty config directory, so it has no stored login.
* Every push to a GitHub URL, in any form, is rewritten to an unresolvable
  host. That covers credentials git would otherwise still find (`~/.netrc`).

Pushes from `git_push` go to a local bare repository; see tools.py.
"""

from __future__ import annotations

import os
from pathlib import Path

REMOVED_VARIABLES = (
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "CPK_INTELLIGENCE_API_KEY",
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "GH_ENTERPRISE_TOKEN",
    "GITHUB_ENTERPRISE_TOKEN",
    "GIT_ASKPASS",
    "SSH_ASKPASS",
    "SSH_AUTH_SOCK",
)

# `.invalid` never resolves (RFC 2606), so a rewritten push fails at once.
BLOCKED_PUSH_URL = "https://push-blocked-by-repo-doctor.invalid/"
_GITHUB_URL_FORMS = (
    "https://github.com/",
    "http://github.com/",
    "git@github.com:",
    "ssh://git@github.com/",
)


def hardened_environment(environ: dict[str, str], gh_config_dir: Path) -> dict[str, str]:
    """A copy of `environ` with every route to the user's GitHub identity closed."""
    env = {k: v for k, v in environ.items() if k not in REMOVED_VARIABLES}
    env.update(
        GIT_TERMINAL_PROMPT="0",
        GIT_CONFIG_GLOBAL=os.devnull,
        GIT_CONFIG_NOSYSTEM="1",
        GIT_SSH_COMMAND="false",
        GH_CONFIG_DIR=str(gh_config_dir),
        GH_PROMPT_DISABLED="1",
    )
    # Config passed through the environment still applies with the global and
    # system files disabled.
    env["GIT_CONFIG_COUNT"] = str(len(_GITHUB_URL_FORMS))
    for index, form in enumerate(_GITHUB_URL_FORMS):
        env[f"GIT_CONFIG_KEY_{index}"] = f"url.{BLOCKED_PUSH_URL}.pushInsteadOf"
        env[f"GIT_CONFIG_VALUE_{index}"] = form
    return env


def harden_process_environment(gh_config_dir: Path) -> None:
    """Applies `hardened_environment` to this process before the harness starts."""
    gh_config_dir.mkdir(parents=True, exist_ok=True)
    hardened = hardened_environment(dict(os.environ), gh_config_dir)
    for name in set(os.environ) - set(hardened):
        del os.environ[name]
    os.environ.update(hardened)
