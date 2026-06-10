// Ambient declarations for type-only gaps in third-party packages.
// This file must stay a script (no top-level import/export) so these
// declarations remain global.

// katex ships no type declarations for its CSS entrypoints; the stylesheet is
// dynamically imported for its side effect only (see useKatexStyles).
declare module "katex/dist/katex.min.css";

// react-markdown@8 references the global `JSX` namespace, which
// @types/react@19 removed in favor of `React.JSX`. Re-expose the React 19
// JSX types globally so react-markdown's declarations keep typechecking.
declare namespace JSX {
  type Element = import("react").JSX.Element;
  type ElementType = import("react").JSX.ElementType;
  interface ElementClass extends import("react").JSX.ElementClass {}
  interface ElementAttributesProperty
    extends import("react").JSX.ElementAttributesProperty {}
  interface ElementChildrenAttribute
    extends import("react").JSX.ElementChildrenAttribute {}
  type LibraryManagedAttributes<C, P> =
    import("react").JSX.LibraryManagedAttributes<C, P>;
  interface IntrinsicAttributes
    extends import("react").JSX.IntrinsicAttributes {}
  interface IntrinsicClassAttributes<T>
    extends import("react").JSX.IntrinsicClassAttributes<T> {}
  interface IntrinsicElements extends import("react").JSX.IntrinsicElements {}
}
