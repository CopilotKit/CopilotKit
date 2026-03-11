#!/bin/bash
source scripts/qa/lib/bash/prelude.sh

# Create the next app in /tmp
UPGRADE_EXPRESS_PATH="/tmp/upgrade-express"

rm -rf $UPGRADE_EXPRESS_PATH

echo "Creating express app for testing upgrade in $UPGRADE_EXPRESS_PATH"


mkdir -p $UPGRADE_EXPRESS_PATH
npx create-next-app $UPGRADE_EXPRESS_PATH --ts --eslint --use-npm --no-tailwind --src-dir --app --import-alias="@/*"

echo "Fetching released versions of CopilotKit packages..."
released_packages=$(get_latest_copilotkit_versions)
echo "Latest released versions: $released_packages"

# write to .env
echo "OPENAI_API_KEY=$OPENAI_API_KEY" > $UPGRADE_EXPRESS_PATH/.env

(cd $UPGRADE_EXPRESS_PATH && npm install $released_packages --save)
(cd $UPGRADE_EXPRESS_PATH && npm install express)
(cd $UPGRADE_EXPRESS_PATH && npm i --save-dev @types/express)

echo "Using released CopilotKit packages: $released_packages"
echo "Testing upgrading to pre-release versions: $packages"

(cd $UPGRADE_EXPRESS_PATH && npm install -D typescript ts-node @types/node)


cp scripts/qa/lib/upgrade-express/old/page.tsx $UPGRADE_EXPRESS_PATH/src/app/page.tsx
cp scripts/qa/lib/upgrade-express/old/server.ts $UPGRADE_EXPRESS_PATH/server.ts

jq '. * {
  "ts-node": {
    "compilerOptions": {
      "module": "commonjs"
    }
  }
}' $UPGRADE_EXPRESS_PATH/tsconfig.json > $UPGRADE_EXPRESS_PATH/temp.json && mv $UPGRADE_EXPRESS_PATH/temp.json $UPGRADE_EXPRESS_PATH/tsconfig.json

prompt "Check server.ts and page.tsx. Are they without errors in VSCode?"

echo "Upgrading packages"

(cd $UPGRADE_EXPRESS_PATH && npm install $packages --save)

cp scripts/qa/lib/upgrade-express/new/page.tsx $UPGRADE_EXPRESS_PATH/src/app/page.tsx
cp scripts/qa/lib/upgrade-express/new/server.ts $UPGRADE_EXPRESS_PATH/server.ts

prompt "Check server.ts and page.tsx again. Are they without errors in VSCode?"

echo "now run ts-node server.ts to test"
cleanup;

exit 0;
