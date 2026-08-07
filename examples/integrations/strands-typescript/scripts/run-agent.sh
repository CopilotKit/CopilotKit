#!/bin/bash

# Navigate to the agent directory
cd "$(dirname "$0")/../agent" || exit 1

# Run the agent using tsx
npx tsx main.ts
