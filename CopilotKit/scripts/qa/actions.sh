#!/bin/bash
source scripts/qa/lib/bash/prelude.sh

# Create the next app in /tmp
ACTIONS_APP_PATH="/tmp/test-actions-app"
echo "Creating next app in $ACTIONS_APP_PATH"
echo ""

# Remove prev project and run create-next-app
npx create-next-app $ACTIONS_APP_PATH --ts --eslint --use-npm --no-tailwind --src-dir --app --import-alias="@/*"

npm_install_packages $ACTIONS_APP_PATH 

cp -r scripts/qa/lib/actions $ACTIONS_APP_PATH/src/app/actions

# Open VSCode
code $ACTIONS_APP_PATH

prompt "Are all actions in the 'good' folder without errors in VSCode?"
prompt "Do all actions in the 'bad' folder have errors in VSCode?"

succeed "Test completed successfully."

echo "===================="
echo "Test completed at $(date)"
echo "===================="

exit 0
