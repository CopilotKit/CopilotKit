#!/bin/bash
source scripts/qa/lib/bash/prelude.sh

# Create the next app in /tmp
LC_APP_PATH="/tmp/test-langchain-app"
echo "Creating next app in $LC_APP_PATH"
echo ""

# Remove prev project and run create-next-app
rm -rf $LC_APP_PATH
npx create-next-app $LC_APP_PATH --ts --eslint --use-npm --no-tailwind --src-dir --app --import-alias="@/*"

# write to .env
echo "OPENAI_API_KEY=$OPENAI_API_KEY" > $LC_APP_PATH/.env

npm_install_packages $LC_APP_PATH 
(cd $LC_APP_PATH && npm install @langchain/community@latest @langchain/core@latest @langchain/langgraph@latest @langchain/openai@latest)

cp scripts/qa/lib/langchain/page.tsx $LC_APP_PATH/src/app/page.tsx

# Open VSCode
code $LC_APP_PATH

mkdir -p $LC_APP_PATH/src/app/api/copilotkit/langchain/
cp scripts/qa/lib/langchain/route.ts $LC_APP_PATH/src/app/api/copilotkit/langchain/route.ts

prompt "Open route.ts. Is it without errors in VSCode?"

# Temporarily disable -e 
set +e

pushd $LC_APP_PATH

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
