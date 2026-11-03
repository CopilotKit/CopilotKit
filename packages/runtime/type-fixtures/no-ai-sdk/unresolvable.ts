// tsconfig.json maps `ai`, `@ai-sdk/*` and `@tanstack/ai*` here. This file
// joins the program only if a declaration reached by consumer.ts imports one
// of them, and then the line below fails the compile.
const reached: never = "the root entry's types import a model SDK";
export default reached;
