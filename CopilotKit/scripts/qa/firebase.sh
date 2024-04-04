#!/bin/bash
source scripts/qa/lib/bash/prelude.sh

# Create the next app in /tmp
FIREBASE_APP_PATH="/tmp/test-firebase-app"

rm -rf $FIREBASE_APP_PATH

echo "Creating firebase app in $FIREBASE_APP_PATH"

# prepare the python app

mkdir -p $FIREBASE_APP_PATH
npx create-next-app $FIREBASE_APP_PATH --ts --eslint --use-npm --no-tailwind --src-dir --app --import-alias="@/*"
echo "OPENAI_API_KEY=$OPENAI_API_KEY" > $FIREBASE_APP_PATH/.env
npm_install_packages $FIREBASE_APP_PATH 

mkdir -p $FIREBASE_APP_PATH/functions
mkdir -p $FIREBASE_APP_PATH/functions/src
cp scripts/qa/lib/firebase/.firebaserc $FIREBASE_APP_PATH/.firebaserc
cp scripts/qa/lib/firebase/firebase.json $FIREBASE_APP_PATH/firebase.json
cp scripts/qa/lib/firebase/index.ts $FIREBASE_APP_PATH/functions/src/index.ts
cp scripts/qa/lib/firebase/package.json $FIREBASE_APP_PATH/functions/package.json
cp scripts/qa/lib/firebase/tsconfig.json $FIREBASE_APP_PATH/functions/tsconfig.json
cp scripts/qa/lib/firebase/page.tsx $FIREBASE_APP_PATH/src/app/page.tsx

npm_install_packages $FIREBASE_APP_PATH/functions

# Temporarily disable -e 
set +e

pushd $FIREBASE_APP_PATH

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
popd

# Start firebase

pushd $FIREBASE_APP_PATH/functions
npm run serve > /dev/null 2>&1 &
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
