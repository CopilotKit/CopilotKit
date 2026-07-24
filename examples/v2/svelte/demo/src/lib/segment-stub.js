export class Analytics {
  constructor() {}
  alias() {
    return this;
  }
  group() {
    return this;
  }
  identify() {
    return this;
  }
  track() {
    return this;
  }
  page() {
    return this;
  }
  screen() {
    return this;
  }
  flush() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
  register() {
    return this;
  }
  deregister() {
    return this;
  }
}
export default Analytics;
