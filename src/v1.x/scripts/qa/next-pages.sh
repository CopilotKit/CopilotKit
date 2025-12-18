#!/bin/bash
source scripts/qa/lib/bash/prelude.sh


# Create the next app in /tmp
NEXT_PAGES_APP_PATH="/tmp/test-next-pages-app"
echo "Creating next app in $NEXT_PAGES_APP_PATH"
echo ""

# Remove prev project and run create-next-app
rm -rf $NEXT_PAGES_APP_PATH
npx create-next-app $NEXT_PAGES_APP_PATH --ts --eslint --use-npm --no-tailwind --src-dir --no-app --import-alias="@/*"

# write to .env
echo "OPENAI_API_KEY=$OPENAI_API_KEY" > $NEXT_PAGES_APP_PATH/.env

npm_install_packages $NEXT_PAGES_APP_PATH 

cp scripts/qa/lib/next-pages/index.tsx $NEXT_PAGES_APP_PATH/src/pages/index.tsx

# Open VSCode
code $NEXT_PAGES_APP_PATH

prompt "Open index.tsx. Is it without errors in VSCode?"


cp scripts/qa/lib/next-pages/copilotkit.ts $NEXT_PAGES_APP_PATH/src/pages/api/copilotkit.ts

prompt "Open copilotkit.ts. Is it without errors in VSCode?"

# Temporarily disable -e 
set +e

pushd $NEXT_PAGES_APP_PATH

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

pid1=$!

popd

prompt "Open http://localhost:3000. Is the page without errors?"
prompt "Chat to check if regular text and message history works (2x)?"
prompt "Ask the copilot to change the message. Is the message changed?"
prompt "Ask the copilot to change the message again. Is the message changed?"
prompt "Ask for a long message. Does the custom render work & stream?"
prompt "Does it provide the current message when asked?"
prompt "Test the keyboard shortcut cmd-\\ to open close the sidebar. Does it work?"
prompt "Does the text input autofocus when the sidebar is opened?"
prompt "In the text area, start a text about elephants. Does the autosuggestions work?"

killall next-server;

succeed "Test completed successfully."

echo "===================="
echo "Test completed at $(date)"
echo "===================="

exit 0
