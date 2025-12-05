#!/bin/bash
source scripts/qa/lib/bash/prelude.sh

# Create the next app in /tmp
UPGRADE_NODE_APP_PATH="/tmp/upgrade-node"

rm -rf $UPGRADE_NODE_APP_PATH

echo "Creating node app for testing upgrade in $UPGRADE_NODE_APP_PATH"


mkdir -p $UPGRADE_NODE_APP_PATH
npx create-next-app $UPGRADE_NODE_APP_PATH --ts --eslint --use-npm --no-tailwind --src-dir --app --import-alias="@/*"

echo "Fetching released versions of CopilotKit packages..."
released_packages=$(get_latest_copilotkit_versions)
echo "Latest released versions: $released_packages"

# write to .env
echo "OPENAI_API_KEY=$OPENAI_API_KEY" > $UPGRADE_NODE_APP_PATH/.env

(cd $UPGRADE_NODE_APP_PATH && npm install $released_packages --save)

echo "Using released CopilotKit packages: $released_packages"
echo "Testing upgrading to pre-release versions: $packages"

(cd $UPGRADE_NODE_APP_PATH && npm install -D typescript ts-node @types/node)


cp scripts/qa/lib/upgrade-node/old/page.tsx $UPGRADE_NODE_APP_PATH/src/app/page.tsx
cp scripts/qa/lib/upgrade-node/old/server.ts $UPGRADE_NODE_APP_PATH/server.ts

jq '. * {
  "ts-node": {
    "compilerOptions": {
      "module": "commonjs"
    }
  }
}' $UPGRADE_NODE_APP_PATH/tsconfig.json > $UPGRADE_NODE_APP_PATH/temp.json && mv $UPGRADE_NODE_APP_PATH/temp.json $UPGRADE_NODE_APP_PATH/tsconfig.json

prompt "Check server.ts and page.tsx. Are they without errors in VSCode?"

echo "Upgrading packages"

(cd $UPGRADE_NODE_APP_PATH && npm install $packages --save)

cp scripts/qa/lib/upgrade-node/new/page.tsx $UPGRADE_NODE_APP_PATH/src/app/page.tsx
cp scripts/qa/lib/upgrade-node/new/server.ts $UPGRADE_NODE_APP_PATH/server.ts

prompt "Check server.ts and page.tsx again. Are they without errors in VSCode?"

echo "now run ts-node server.ts to test"
cleanup;

exit 0;
