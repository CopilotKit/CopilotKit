#!/bin/bash
source scripts/qa/lib/bash/prelude.sh

# Create the next app in /tmp
UPGRADE_NEXT_APP_ROUTER_PATH="/tmp/upgrade-next-app-router"
echo "Creating next app for testing upgrading next app router in $UPGRADE_NEXT_APP_ROUTER_PATH"
echo ""

# Remove prev project and run create-next-app
rm -rf $UPGRADE_NEXT_APP_ROUTER_PATH
npx create-next-app $UPGRADE_NEXT_APP_ROUTER_PATH --ts --eslint --use-npm --no-tailwind --src-dir --app --import-alias="@/*"

echo "Fetching released versions of CopilotKit packages..."
released_packages=$(get_latest_copilotkit_versions)
echo "Latest released versions: $released_packages"

# write to .env
echo "OPENAI_API_KEY=$OPENAI_API_KEY" > $UPGRADE_NEXT_APP_ROUTER_PATH/.env

(cd $UPGRADE_NEXT_APP_ROUTER_PATH && npm install $released_packages --save)

echo "Using released CopilotKit packages: $released_packages"
echo "Testing upgrading to pre-release versions: $packages"

cp scripts/qa/lib/upgrade-next-app/old/page.tsx $UPGRADE_NEXT_APP_ROUTER_PATH/src/app/page.tsx
mkdir -p $UPGRADE_NEXT_APP_ROUTER_PATH/src/app/api/copilotkit/openai/
cp scripts/qa/lib/upgrade-next-app/old/route.ts $UPGRADE_NEXT_APP_ROUTER_PATH/src/app/api/copilotkit/openai/route.ts

# Open VSCode
code $UPGRADE_NEXT_APP_ROUTER_PATH

prompt "Check route.ts and page.tsx. Are they without errors in VSCode?"

echo "Upgrading packages"

(cd $UPGRADE_NEXT_APP_ROUTER_PATH && npm install $packages --save)

cp scripts/qa/lib/upgrade-next-app/new/page.tsx $UPGRADE_NEXT_APP_ROUTER_PATH/src/app/page.tsx
cp scripts/qa/lib/upgrade-next-app/new/route.ts $UPGRADE_NEXT_APP_ROUTER_PATH/src/app/api/copilotkit/openai/route.ts

prompt "Check route.ts and page.tsx again. Are they without errors in VSCode?"

cleanup;
exit 0
