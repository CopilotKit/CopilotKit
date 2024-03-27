#!/bin/bash
source scripts/qa/lib/bash/prelude.sh

# Create the next app in /tmp
UPGRADE_PATH_APP="/tmp/upgrade-path-app"
echo "Creating next app for testing upgrade path in $UPGRADE_PATH_APP"
echo ""

# Remove prev project and run create-next-app
rm -rf $UPGRADE_PATH_APP
npx create-next-app $UPGRADE_PATH_APP --ts --eslint --use-npm --no-tailwind --src-dir --app --import-alias="@/*"

echo "Fetching released versions of CopilotKit packages..."
released_packages=$(get_latest_copilotkit_versions)
echo "Latest released versions: $released_packages"

# write to .env
echo "OPENAI_API_KEY=$OPENAI_API_KEY" > $UPGRADE_PATH_APP/.env

(cd $UPGRADE_PATH_APP && npm install $released_packages --save)

info "Using released CopilotKit packages: $released_packages"
info "Testing upgrading to pre-release versions: $packages"

cp scripts/qa/lib/upgrade/page.tsx $UPGRADE_PATH_APP/src/app/page.tsx

# Open VSCode
code $UPGRADE_PATH_APP

prompt "Open page.tsx. Is it without errors in VSCode?"

mkdir -p $UPGRADE_PATH_APP/src/app/api/copilotkit/openai/

cp scripts/qa/lib/upgrade/route.ts $UPGRADE_PATH_APP/src/app/api/copilotkit/openai/route.ts

prompt "Open route.ts. Is it without errors in VSCode?"

# Temporarily disable -e 
set +e

pushd $UPGRADE_PATH_APP

npm run build

exit_status=$?

if [ $exit_status -eq 0 ]; then
    succeed "$pkg_manager build succeeded."
else
    fail "$pkg_manager build failed with status $exit_status."
    exit 1
fi

# Re-enable -e
set -e

npm run dev > /dev/null 2>&1 &

pid=$!

popd

prompt "Open http://localhost:3000. Is the page without errors?"
prompt "Chat to check if regular text and message history works (2x)?"
prompt "Ask the copilot to change the message. Is the message changed?"
prompt "Ask the copilot to change the message again. Is the message changed?"
prompt "Does it provide the current message when asked?"
prompt "In the text area, start a text about elephants. Does the autosuggestions work?"

killall next-server;
cleanup;

pushd $UPGRADE_PATH_APP
# now install the new packages

npm install $packages --save

npm run build

exit_status=$?

if [ $exit_status -eq 0 ]; then
    succeed "$pkg_manager build succeeded."
else
    fail "$pkg_manager build failed with status $exit_status."
    exit 1
fi

npm run dev > /dev/null 2>&1 &

pid=$!

popd

prompt "Open http://localhost:3000. Is the page without errors?"
prompt "Chat to check if regular text and message history works (2x)?"
prompt "Ask the copilot to change the message. Is the message changed?"
prompt "Ask the copilot to change the message again. Is the message changed?"
prompt "Does it provide the current message when asked?"
prompt "In the text area, start a text about elephants. Does the autosuggestions work?"
prompt "Update the code to use new features. Does it work?"

succeed "Test completed successfully."

echo "===================="
echo "Test completed at $(date)"
echo "===================="

killall next-server;
cleanup;

exit 0
