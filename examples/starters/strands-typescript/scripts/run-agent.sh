#!/bin/bash

# Navigate to the agent directory
cd "$(dirname "$0")/../agent" || exit 1

# Run the Strands agent (Express + tsx) with hot reload
npx tsx --watch src/server.ts
