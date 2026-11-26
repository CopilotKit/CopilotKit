#!/bin/bash

# Navigate to the agent directory
cd "$(dirname "$0")/../agent" || exit 1

# Install the Worker's dependencies (Agents SDK, AI SDK, the AG-UI adapter and wrangler)
npm install
