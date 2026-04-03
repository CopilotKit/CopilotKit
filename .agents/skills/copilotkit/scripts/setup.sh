#!/usr/bin/env bash
#
# setup.sh
#
# One-command setup for CopilotKit AI agent skills.
# Installs public + internal skills, enables auto-updates,
# then launches Claude Code to complete onboarding.
#
# Idempotent — skips steps that are already done.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/CopilotKit/skills/main/scripts/setup.sh | bash

set -euo pipefail

echo "=== CopilotKit Skills Setup ==="
echo ""

changed=false

# 1. Install public skills (skip if already present)
if [ -d "$HOME/.claude/skills/copilotkit-setup" ] || [ -d "$HOME/.agents/skills/copilotkit-setup" ]; then
    echo "Public skills already installed"
else
    echo "Installing CopilotKit/skills (public)..."
    npx skills add copilotkit/skills --full-depth -y
    changed=true
fi

# 2. Install internal skills if user has CopilotKit org access (skip if already present)
if [ -d "$HOME/.claude/skills/cr-loop" ] || [ -d "$HOME/.agents/skills/cr-loop" ]; then
    echo "Internal skills already installed"
elif ssh -T git@github.com 2>&1 | grep -qi "authenticated" && \
     git ls-remote git@github.com:CopilotKit/internal-skills.git HEAD &>/dev/null; then
    echo "Installing CopilotKit/internal-skills (team member detected)..."
    npx skills add CopilotKit/internal-skills -y
    changed=true
else
    echo "Skipping internal skills (CopilotKit team access not detected)"
fi

# 3. Enable auto-updates
python3 << 'PYEOF'
import json, os, sys

settings_path = os.path.expanduser("~/.claude/settings.json")
if not os.path.exists(settings_path):
    os.makedirs(os.path.dirname(settings_path), exist_ok=True)
    with open(settings_path, "w") as f:
        json.dump({}, f)

with open(settings_path) as f:
    settings = json.load(f)

markets = settings.get("extraKnownMarketplaces", {})
changed = False

for name in ["copilotkit-plugins", "copilotkit-internal-plugins"]:
    if name in markets and not markets[name].get("autoUpdate"):
        markets[name]["autoUpdate"] = True
        changed = True

if changed:
    with open(settings_path, "w") as f:
        json.dump(settings, f, indent=2)
    print("Enabled auto-updates")
    # Signal to outer script
    sys.exit(2)
PYEOF
autoupdate_status=$?
if [ "$autoupdate_status" -eq 2 ]; then
    changed=true
fi

echo ""

if [ "$changed" = true ]; then
    echo "=== Setup complete ==="
    echo ""
    if command -v claude &>/dev/null; then
        echo "Launching Claude Code to finish onboarding..."
        echo ""
        claude "onboard me for CopilotKit"
    else
        echo "Start Claude Code and say: onboard me for CopilotKit"
    fi
else
    echo "Everything is already set up."
fi
