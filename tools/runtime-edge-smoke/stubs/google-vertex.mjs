// PE-1102: BuiltInAgent's classic mode imports @ai-sdk/google-vertex, which
// pulls google-auth-library (child_process, fs, https, crypto, ...).
export function createVertex() {
  throw new Error("@ai-sdk/google-vertex is stubbed in the edge smoke test");
}
