# QA — open-gen-ui

## Scope

Manual QA for the minimal Open Generative UI demo. The agent emits a
`generateSandboxedUi` tool call on every turn; the runtime's
OpenGenerativeUIMiddleware converts that into activity events that mount
the authored HTML/CSS in a sandboxed iframe.

## Happy path

- [ ] Navigate to `/demos/open-gen-ui`.
- [ ] Composer shows the four visualization suggestion pills.
- [ ] Click "3D axis visualization (model airplane)" — a sandboxed iframe
      mounts showing an airplane cycling through pitch/yaw/roll rotations.
- [ ] Click "How a neural network works" — an iframe mounts showing a
      layered network with forward-pass activations.

## Regression

- [ ] The rendered scenes include axis labels, a legend, and a title.
- [ ] No console errors from the sandboxed iframe.

## Known gaps

- Strands backend uses the shared agent; the `generateSandboxedUi`
  frontend-registered tool is resolved via ag_ui_strands' frontend-tool
  proxy. The design skill prompt lives on the frontend via
  `openGenerativeUI.designSkill`.
