#!/usr/bin/env bash
set -e  # Exit immediately if a command exits with a non-zero status.

# load .env.local if present
if [ -f .env.local ]; then
  set -a # automatically export all variables
  source .env.local
  set +a # stop automatically exporting
fi

# save the current branch
current_branch=$(git branch --show-current)

# quit if the current branch is main
if [ "$current_branch" = "main" ]; then
  printf "\e[41m\e[97m!!\e[0m Error: Can't release pre release from main branch\n"
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
