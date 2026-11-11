// Fixture for the generative-ui/native contract: a react-dom SUBPATH. It stays
// external like react-dom itself, so it is caught on the external specifier,
// which must be read as the react-dom package.
import { createRoot } from "react-dom/client";

export const root = createRoot;
