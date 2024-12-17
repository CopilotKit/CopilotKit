#! /bin/bash

set -e # Exit immediately if a command exits with a non-zero status

# Save the current directory
root_dir=$(pwd)

# Ensure the script returns to the initial directory on exit or failure
trap 'cd "$root_dir"' EXIT ERR

echo "Linking packages globally..."
turbo link:global

echo "Setting up the JS environment..."
cd ../examples/coagents-research-canvas/ui
rm -rf .next
pnpm i
pnpm link --global @copilotkit/react-ui @copilotkit/react-core @copilotkit/runtime-client-gql \
  @copilotkit/shared @copilotkit/runtime @copilotkit/sdk-js

echo "Setting up the Python environment..."
cd "$root_dir/../examples/coagents-research-canvas/agent"
poetry lock
poetry install
poetry add --editable ../../../sdk-python

echo "Running the app..."
parallel --ungroup ::: \
  "cd $root_dir && exec > >(sed 's/^/\x1b[1;32m[CopilotKit]\x1b[0m /') 2>&1 && turbo run dev" \
  "cd $root_dir/../examples/coagents-research-canvas/agent && exec > >(sed 's/^/\x1b[1;31m[Agent     ]\x1b[0m /') 2>&1 && poetry run demo" \
  "cd $root_dir/../examples/coagents-research-canvas/ui && exec > >(sed 's/^/\x1b[1;34m[Frontend  ]\x1b[0m /') 2>&1 && pnpm dev"