import { useKatexStyles as useKatex } from "@copilotkit/vue/v2";
import { onMounted } from "vue";

export function setup() {
  onMounted(() => {
    useKatex();
  });
}
