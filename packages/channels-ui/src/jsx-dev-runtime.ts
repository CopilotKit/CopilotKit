export { jsx, jsxs, Fragment } from "./jsx-runtime.js";
export function jsxDEV(type: any, props: any, key?: any) {
  return { type, props: props ?? {}, key };
}
