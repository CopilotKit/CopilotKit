#!/usr/bin/env bash
set -e  # Exit immediately if a command exits with a non-zero status.

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
pnpm changeset pre enter --branch $current_branch "beta-$current_branch"

# select the packages you want to push an update for
pnpm changeset

# get out of pre mode
pnpm changeset pre exit
