source scripts/qa/lib/bash/qa.sh
source scripts/qa/lib/bash/packages.sh

prerelease_tag="$1"
packages=""

if [ -n "$prerelease_tag" ]; then
  echo "Fetching pre-release CopilotKit packages..."
  packages=$(get_latest_copilotkit_prerelase_versions "$prerelease_tag")
  echo "Pre-release CopilotKit packages: $packages"
fi

if [ -z "$packages" ]; then
  echo "No pre-release CopilotKit packages provided."
  read -p "Enter package names separated by space or Enter to install local packages: " packages
fi

if [ -z "$packages" ]; then
  echo "Installing local packages..."
else
  echo "Installing packages: $packages"
fi

# only prompt for openai key if it is not set already
if [ -z "$OPENAI_API_KEY" ]; then
  read -p "Enter OpenAI API key: " OPENAI_API_KEY
else
  # Extract the first 5 characters of the API key
  key_start=${OPENAI_API_KEY:0:5}
  # Calculate the number of asterisks to print based on the key length
  num_asterisks=$((${#OPENAI_API_KEY}-5))
  asterisks=$(printf '%*s' "$num_asterisks" '' | tr ' ' '*')
  echo "Using existing OPENAI_API_KEY: $key_start$asterisks"
fi

pid1=0
pid2=0
pid3=0

cleanup() {
  if [ $pid1 -ne 0 ]; then
    kill -9 $pid1 2>/dev/null || true
  fi
  if [ $pid2 -ne 0 ]; then
    kill -9 $pid2 2>/dev/null || true
  fi
  if [ $pid3 -ne 0 ]; then
    kill -9 $pid3 2>/dev/null || true
  fi
  killall next-server 2>/dev/null || true
}

# Trap Ctrl+C (INT signal) and exit
trap "echo 'Script interrupted.'; cleanup; exit" INT
trap "cleanup" EXIT

# Exit on any error
set -e

# record the current date + time
info "Test started at $(date)"
