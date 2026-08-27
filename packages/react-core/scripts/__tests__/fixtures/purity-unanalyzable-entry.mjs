// Fixture for the fail-loud contract: a loader whose argument is not a string
// literal is a hole in the graph, so the scan must report it rather than call the
// entry clean.
export const load = (name) => import(name);
