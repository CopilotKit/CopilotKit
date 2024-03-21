#!/bin/bash

SCRIPT_DIR=$(dirname "${BASH_SOURCE[0]}")
source "${SCRIPT_DIR}/lib/bash/qa.sh"
source "${SCRIPT_DIR}/lib/bash/npm.sh"

prerelease_tag="$1"

if [ -z "$prerelease_tag" ]; then
  echo "Usage: $0 <prerelease_tag>"
  exit 1
fi

pid=0

cleanup() {
  if [ $pid -ne 0 ]; then
    kill -9 $pid 2>/dev/null || true
  fi
  killall next-server;
}


# Trap Ctrl+C (INT signal) and exit
trap "echo 'Script interrupted.'; cleanup; exit" INT
trap "cleanup" EXIT

# Exit on any error
set -e

# record the current date + time
info "Test started at $(date)"

# Create the next app in /tmp
NEXT_APP_PATH="/tmp/test-next-app"
echo "Creating next app in $NEXT_APP_PATH"
echo ""

# Read the package manager 
read -p "Enter package manager (yarn/npm): " pkg_manager

# Remove prev project and run create-next-app
rm -rf $NEXT_APP_PATH
if [ "$pkg_manager" = "yarn" ]; then
    yarn create next-app $NEXT_APP_PATH --ts --eslint --no-tailwind --src-dir --app --import-alias="@/*"
elif [ "$pkg_manager" = "npm" ]; then
    npx create-next-app $NEXT_APP_PATH --ts --eslint --use-npm --no-tailwind --src-dir --app --import-alias="@/*"
else
    echo "Unsupported package manager. Exiting."
    exit 1
fi

echo "Fetching pre-release versions of CopilotKit packages..."
default_packages=$(get_latest_copilotkit_prerelase_versions "$prerelease_tag")
echo "Latest pre-release versions: $default_packages"

# Install CopilotKit
echo ""
echo "Ready to install CopilotKit. Please input package names."
read -p "Enter package names separated by a space (Enter to accept latest): " packages
packages=${packages:-$default_packages}

echo ""
echo "Using CopilotKit packages: $packages"
echo ""

# only prompt for openai key if it is not set already
if [ -z "$OPENAI_API_KEY" ]; then
  read -p "Enter OpenAI API key: " OPENAI_API_KEY
else
  # Extract the first 5 characters of the API key
  key_start=${OPENAI_API_KEY:0:5}
  # Calculate the number of asterisks to print based on the key length
  num_asterisks=$((${#OPENAI_API_KEY}-5))
  asterisks=$(printf '%*s' "$num_asterisks" '' | tr ' ' '*')
  echo "Using existing OPENAI_API_KEY: $key_start$asterisks"
fi

# write to .env
echo "OPENAI_API_KEY=$OPENAI_API_KEY" > $NEXT_APP_PATH/.env

if [ "$pkg_manager" = "yarn" ]; then
    (cd $NEXT_APP_PATH && yarn add $packages)
elif [ "$pkg_manager" = "npm" ]; then
    (cd $NEXT_APP_PATH && npm install $packages --save)
fi

info "Package manager: $pkg_manager"
info "Using CopilotKit packages: $packages"

# Create the test page
cat <<EOF > $NEXT_APP_PATH/src/app/page.tsx
"use client";
import {
  CopilotKit,
  useCopilotAction,
  useMakeCopilotReadable,
} from "@copilotkit/react-core";
import { CopilotTextarea } from "@copilotkit/react-textarea";
import { CopilotSidebar } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";
import { useState } from "react";
import "@copilotkit/react-textarea/styles.css";
import "@copilotkit/react-ui/styles.css";
function InsideHome() {
  const [message, setMessage] = useState("Hello World!");
  const [text, setText] = useState("");
  useMakeCopilotReadable(
    "This is the current message: " + JSON.stringify(message)
  );
  useCopilotAction(
    {
      name: "displayMessage",
      description: "Display a message.",
      parameters: [
        {
          name: "message",
          type: "string",
          description: "The message to display.",
          required: true,
        },
      ],
      handler: async ({ message }) => {
        setMessage(message);
      },
      render: (props) => {
        return (
          <div style={{ backgroundColor: "black", color: "white" }}>
            <div>Status: {props.status}</div>
            <div>Message: {props.args.message}</div>
          </div>
        );
      },
    },
    []
  );
  return (
    <>
      <div>{message}</div>
      <CopilotTextarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        autosuggestionsConfig={{
          textareaPurpose: "an outline of a presentation about elephants",
          chatApiConfigs: {},
        }}
      />
    </>
  );
}
export default function Home() {
  return (
    <CopilotKit url="/api/copilotkit/openai">
      <CopilotSidebar
        defaultOpen={true}
        labels={{
          title: "Presentation Copilot",
          initial: "Hi you! 👋 I can give you a presentation on any topic.",
        }}
      >
        <InsideHome />
      </CopilotSidebar>
    </CopilotKit>
  );
}

EOF

# Open VSCode
code $NEXT_APP_PATH

prompt "Open page.tsx. Is it without errors in VSCode?"

mkdir -p $NEXT_APP_PATH/src/app/api/copilotkit/openai/

cat <<EOF > $NEXT_APP_PATH/src/app/api/copilotkit/openai/route.ts
import { CopilotBackend, OpenAIAdapter } from "@copilotkit/backend";

export async function POST(req: Request): Promise<Response> {
  const copilotKit = new CopilotBackend();  
  return copilotKit.response(req, new OpenAIAdapter({}));
}
EOF

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

pid=$!

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
