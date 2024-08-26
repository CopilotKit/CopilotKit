#!/bin/bash
source scripts/qa/lib/bash/prelude.sh

# Read the package manager 
read -p "Enter package manager (yarn/npm): " pkg_manager

if [ -z "$pkg_manager" ]; then
    pkg_manager="npm"
fi

if [ "$pkg_manager" != "yarn" ] && [ "$pkg_manager" != "npm" ]; then
    echo "Unsupported package manager. Exiting."
    exit 1
fi

# Create the next app in /tmp
NEXT_APP_PATH="/tmp/test-next-app"
echo "Creating next app in $NEXT_APP_PATH"
echo ""

# Remove prev project and run create-next-app
rm -rf $NEXT_APP_PATH
if [ "$pkg_manager" = "yarn" ]; then
    (cd /tmp && yarn create next-app $NEXT_APP_PATH --ts --eslint --no-tailwind --src-dir --app --import-alias="@/*")
elif [ "$pkg_manager" = "npm" ]; then
    npx create-next-app $NEXT_APP_PATH --ts --eslint --use-npm --no-tailwind --src-dir --app --import-alias="@/*"
fi

# write to .env
echo "OPENAI_API_KEY=$OPENAI_API_KEY" > $NEXT_APP_PATH/.env

if [ "$pkg_manager" = "yarn" ]; then
  yarn_install_packages $NEXT_APP_PATH 
elif [ "$pkg_manager" = "npm" ]; then
  npm_install_packages $NEXT_APP_PATH 
fi

cp scripts/qa/lib/next/page.tsx $NEXT_APP_PATH/src/app/page.tsx

# Open VSCode
code $NEXT_APP_PATH

prompt "Open page.tsx. Is it without errors in VSCode?"

mkdir -p $NEXT_APP_PATH/src/app/api/copilotkit/openai/
cp scripts/qa/lib/next/route.ts $NEXT_APP_PATH/src/app/api/copilotkit/openai/route.ts

prompt "Open route.ts. Is it without errors in VSCode?"

# Temporarily disable -e 
set +e

pushd $NEXT_APP_PATH

if [ "$pkg_manager" = "yarn" ]; then
    yarn build
elif [ "$pkg_manager" = "npm" ]; then
    npm run build
fi

exit_status=$?

if [ $exit_status -eq 0 ]; then
    succeed "$pkg_manager build succeeded."
else
    fail "$pkg_manager build failed with status $exit_status."
    exit 1
fi

# Re-enable -e
set -e

if [ "$pkg_manager" = "yarn" ]; then
    yarn dev > /dev/null 2>&1 &
elif [ "$pkg_manager" = "npm" ]; then
    npm run dev > /dev/null 2>&1 &
fi

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
prompt "In the text area, start a text about elephants. Do the autosuggestions work?"
prompt "Verify that the text area also completes text in the middle of the sentence."

killall next-server;

succeed "Test completed successfully."

echo "===================="
echo "Test completed at $(date)"
echo "===================="

exit 0
