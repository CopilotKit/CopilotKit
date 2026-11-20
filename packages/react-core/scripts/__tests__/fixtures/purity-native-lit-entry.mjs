// Fixture for the generative-ui/native contract: lit-html reads `document` while
// its module loads, which throws under Hermes before any component renders.
import { LitElement } from "lit";

export class Widget extends LitElement {}
