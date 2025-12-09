#!/bin/bash
source scripts/qa/lib/bash/prelude.sh

# Create the next app in /tmp
NODE_APP_PATH="/tmp/test-node-app"

rm -rf $NODE_APP_PATH

echo "Creating node app in $NODE_APP_PATH"

# prepare the python app

mkdir -p $NODE_APP_PATH
npx create-next-app $NODE_APP_PATH --ts --eslint --use-npm --no-tailwind --src-dir --app --import-alias="@/*"
npm_install_packages $NODE_APP_PATH 
(cd $NODE_APP_PATH && npm install -D typescript ts-node @types/node)


cp scripts/qa/lib/node/page.tsx $NODE_APP_PATH/src/app/page.tsx
cp scripts/qa/lib/node/server.ts $NODE_APP_PATH/server.ts

# Temporarily disable -e 
set +e

pushd $NODE_APP_PATH

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

# Start next server
npm run dev > /dev/null 2>&1 &
pid1=$!

# Start node server
node npx ts-node server.ts > /dev/null 2>&1 &
pid2=$!
popd


prompt "Open http://localhost:3000. Is the page without errors?"
prompt "Chat with it. Does it work?"
prompt "Ask it to change the message. Does it work?"

killall next-server;
cleanup;

succeed "Test completed successfully."

echo "===================="
echo "Test completed at $(date)"
echo "===================="

exit 0;
