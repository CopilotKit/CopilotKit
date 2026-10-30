import { createGenerativeUI } from "../../../catalog";
import { testComponents } from "../../../__tests__/render";
import { compositeComponents } from "../index";

export const ui = createGenerativeUI({
  id: "test/composites@1",
  components: { ...compositeComponents, ...testComponents },
});
