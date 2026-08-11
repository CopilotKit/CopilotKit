---
"@copilotkit/react-native": patch
---

fix(react-native): load expo attachment peers lazily so bare RN apps work without Expo

`useAttachments` imported `expo-document-picker` and `expo-file-system` at the top
level of the module, and `useAttachments` is re-exported from the package root and
used internally by `CopilotChat`. Because those imports were static, importing
_anything_ from `@copilotkit/react-native` (e.g. the documented quick-start
`CopilotKitProvider` / `useAgent`) pulled both Expo modules into the consumer's
bundle — even though they are declared as **optional** peer dependencies
(`peerDependenciesMeta`). In a bare React Native app without Expo this broke two
ways: Metro failed to resolve the modules at bundle time, and when they were
present as JS-only it crashed at startup in `expo-modules-core`
(`Cannot read property 'EventEmitter' of undefined`) since there is no native
autolinking.

The two modules are now imported lazily, inside the attachment callbacks that
actually use them (`openPicker`, `processFiles`), via dynamic `import()` with a
non-statically-analyzable specifier. Consumers that never use attachments — and
bare RN apps without Expo — can now import the rest of the package without pulling
in Expo or crashing. Attachment users are unaffected; the modules load on first
use, matching the existing optional-peer contract.
