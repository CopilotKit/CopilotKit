import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import next from "eslint-config-next";

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, ...next, {
  rules: {
    "@typescript-eslint/no-unused-vars": "off",
  },
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts"]
}];

export default eslintConfig;
