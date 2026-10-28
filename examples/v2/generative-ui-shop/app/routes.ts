import { index, layout, route } from "@react-router/dev/routes";
import type { RouteConfig } from "@react-router/dev/routes";

export default [
  layout("routes/_landing/_layout.tsx", [
    index("routes/_landing/index.tsx"),
    route("about", "routes/_landing/about.tsx"),
    route("cart", "routes/_landing/cart.tsx"),
    route("compare", "routes/_landing/compare.tsx"),
    route("contact", "routes/_landing/contact.tsx"),
    route("products", "routes/_landing/products/index.tsx"),
    route("products/:productId", "routes/_landing/products/$productId.tsx"),
    route("terms-of-service", "routes/_landing/terms-of-service.tsx"),
    route("terms-of-use", "routes/_landing/terms-of-use.tsx"),
  ]),
  route("api/copilotkit/*", "routes/api.copilotkit.$.tsx"),
  route("api/compare", "routes/api.compare.tsx"),
  route("api/compare-data", "routes/api.compare-data.tsx"),
] satisfies RouteConfig;
