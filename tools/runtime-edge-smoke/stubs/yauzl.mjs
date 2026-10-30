// PE-1107 blocker 5: learned-skills archive reading uses yauzl (fs, stream,
// zlib). BuiltInAgent imports it through the skill registry.
export function fromBuffer() {
  throw new Error("yauzl is stubbed in the edge smoke test");
}
