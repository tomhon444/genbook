import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".local/**",
    ".agents/**",
    ".codex/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored Red Wyvern UI Kit assets (copied by `npx red-wyvern-ui-kit init`).
    "public/red-wyvern-ui-kit/**",
  ]),
]);

export default eslintConfig;
