// Fixture for the generative-ui/native contract: the class static block lives in
// a split-out chunk, not in the entry, so only a scan that follows the relative
// edge out of the entry can see it.
export class Boundary {
  static {
    this.contextType = null;
  }
}
