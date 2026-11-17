// Fixture for the generative-ui/native contract: React Native has no DOM, so its
// entry must not import react-dom. react-dom stays EXTERNAL when the guard
// bundles (it never becomes a graph input), so this is caught on the external
// edge, not on a resolved file.
import { createPortal } from "react-dom";

export const portal = createPortal;
