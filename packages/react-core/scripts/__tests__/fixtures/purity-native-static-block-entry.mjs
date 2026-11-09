// Fixture for the generative-ui/native contract: a class static block — what the
// build lowers a `static contextType = …` field to — which Metro's Babel preset
// cannot parse, so a React Native app fails to bundle the entry.
export class Boundary {
  static {
    this.contextType = null;
  }
}
