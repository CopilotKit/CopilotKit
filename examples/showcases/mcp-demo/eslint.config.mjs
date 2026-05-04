import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});


const eslintConfig = [
  ...compat.config({
    extends: ['next'],
    rules: {
      'react/no-unescaped-entities': 'off',
      'react/no-unknown-property': 'off',
      'react/no-unused-vars': 'off',
      
      '@next/next/no-page-custom-font': 'off',
    },
  }),
]

export default eslintConfig;
