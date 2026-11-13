// CommonJS half of the static-block-behind-a-chunk fixture.
class Boundary {
  static {
    this.contextType = null;
  }
}

module.exports = { Boundary };
