// Fixture for assert-headless-purity.test.mjs: an entry that names no dependency
// at all and reaches one only through a RELATIVE chunk edge — the shape the old
// substring guard could not see, because it read this file and stopped here.
export * from "./purity-chunk.mjs";
