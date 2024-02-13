#!/usr/bin/env bash

# quit if the current branch is main
if [ "$(git branch --show-current)" = "main" ]; then
  printf "\e[41m\e[97m!!\e[0m Error: Can't release beta from main branch\n"
  exit 1
fi

# quit if there are uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
  printf "\e[41m\e[97m!!\e[0m Error: There are uncommitted changes\n"
  exit 1
fi

echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
echo "!! Releasing new beta version !!"
echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
echo ""

echo "Continue? (y/n)"
read -r response
if [ "$response" != "y" ]; then
  printf "\e[41m\e[97m!!\e[0m Error: Aborted"
  exit 1
fi
