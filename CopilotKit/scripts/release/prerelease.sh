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
  printf "\e[41m\e[97m!!\e[0m Error: Can't release pre release from main branch\n"
  exit 1
fi

# quit if there are uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
  printf "\e[41m\e[97m!!\e[0m Error: There are uncommitted changes\n"
  exit 1
fi

# replace underscores in current_branch with hyphens
package=$(echo $current_branch | sed 's/_/-/g')

# replace all non-alphanumeric characters except hyphens
package=$(echo $package | sed 's/[^a-zA-Z0-9-]/-/g')

# chop leading and trailing hyphens
package=$(echo $package | sed 's/^-//;s/-$//')

echo ""
echo "Branch: $current_branch" 
echo "Package: $package"
echo ""
echo "==============================="
echo "!! Releasing new pre release !!"
echo "==============================="
echo ""

echo "Continue? (y/n)"
read -r response
if [ "$response" != "y" ]; then
  printf "\e[41m\e[97m!!\e[0m Error: Aborted"
  exit 1
fi

# enter pre mode
pnpm changeset pre enter $package

# select the packages to push an update for
pnpm changeset

# bump the version
pnpm changeset version

echo "Commit and run CI? (y/n)"
read -r response
if [ "$response" != "y" ]; then
  printf "\e[41m\e[97m!!\e[0m Error: Aborted"
  exit 1
fi

# Stage and commit
git add -A && git commit -m "Pre release $current_branch" && git push

# Sleep a little so that GitHub picks up the change
sleep 3

# Manually trigger the CI
curl -X POST \
  -H "Accept: application/vnd.github.v3+json" \
  -H "Authorization: token $GH_TOKEN" \
  -d "{\"ref\":\"$current_branch\"}" \
  https://api.github.com/repos/CopilotKit/CopilotKit/actions/workflows/release.yml/dispatches


# get out of pre mode
echo "=================================================="
echo "!! Automatically exiting pre mode in 30 seconds !!"
echo "=================================================="
echo ""

# wait for 30 seconds
sleep 30

# get out of pre mode
pnpm changeset pre exit

# push the changes
git add -A && git commit -m "Pre release $current_branch - exit pre mode" && git push
