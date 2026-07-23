if (!HTMLElement.prototype.scrollTo) {
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: () => undefined,
  });
}
