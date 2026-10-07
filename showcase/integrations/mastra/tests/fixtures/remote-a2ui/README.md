# Separate-server A2UI fixture

From `showcase/integrations/mastra/tests/fixtures/remote-a2ui`, with the
showcase aimock and Mastra frontend running, start the fixture in another
terminal:

```sh
OPENAI_BASE_URL=http://127.0.0.1:4010/v1 \
  ../../../node_modules/.bin/mastra dev \
  --dir "$PWD/mastra" \
  --root "$PWD" \
  --env "$PWD/../../../../../.env"
```

From the repository root, run the shared remote-surface check:

```sh
FRONTEND_URL=http://127.0.0.1:3104 \
REMOTE_COPILOTKIT_URL=http://127.0.0.1:4111/copilotkit \
PROMPT='Draw a sales Dashboard' \
node showcase/harness/src/probes/scripts/d6-gen-ui-remote.mjs
```

The script checks the rendered dashboard and the actual A2UI component and
chart data operations. The reported prompt is backed by the Mastra D6 fixture.
