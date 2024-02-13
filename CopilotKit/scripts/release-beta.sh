#!/usr/bin/env bash
set -e  # Exit immediately if a command exits with a non-zero status.

# load .env.local if present
if [ -f .env.local ]; then
  set -a # automatically export all variables
  source .env.local
  set +a # stop automatically exporting
fi

# if GH_TOKEN is not set, quit
if [ -z "$GH_TOKEN" ]; then
  printf "\e[41m\e[97m!!\e[0m Error: GH_TOKEN is not set\n"
  exit 1
fi

# save the current branch
current_branch=$(git branch --show-current)

# quit if the current branch is main
if [ "$current_branch" = "main" ]; then
  printf "\e[41m\e[97m!!\e[0m Error: Can't release beta from main branch\n"
  exit 1
fi

# quit if there are uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
  printf "\e[41m\e[97m!!\e[0m Error: There are uncommitted changes\n"
  exit 1
fi

echo ""
echo "Branch: beta-$current_branch" 
echo ""
echo "================================"
echo "!! Releasing new beta version !!"
echo "================================"
echo ""

echo "Continue? (y/n)"
read -r response
if [ "$response" != "y" ]; then
  printf "\e[41m\e[97m!!\e[0m Error: Aborted"
  exit 1
fi

# create a new beta version named "beta-<current-branch>"
pnpm changeset pre enter $current_branch --branch $current_branch

# select the packages you want to push an update for
pnpm changeset

# get out of pre mode
pnpm changeset pre exit

echo "Commit and run CI? (y/n)"
read -r response
if [ "$response" != "y" ]; then
  printf "\e[41m\e[97m!!\e[0m Error: Aborted"
  exit 1
fi

# Stage and commit
git add -A && git commit -m "Beta release $current_branch"

# Sleep a little so that GitHub picks up the change
sleep 3

# Manually trigger the CI
# curl -X POST \
#   -H "Accept: application/vnd.github.v3+json" \
#   -H "Authorization: token $GH_TOKEN" \
#   -d "{\"ref\":\"$current_branch\"}" \
#   https://api.github.com/repos/CopilotKit/CopilotKit/actions/workflows/ci.yml/dispatches
