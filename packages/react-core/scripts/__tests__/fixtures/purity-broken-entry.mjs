// Fixture for the fail-loud contract: an edge that cannot be resolved must never
// read as "clean", because it hides every module behind it.
export * from "./purity-does-not-exist.mjs";
