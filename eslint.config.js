import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
const typescriptWorkspaceFiles = [
  "packages/*/src/**/*.ts",
  "apps/*/src/**/*.ts",
  "adapters/*/src/**/*.ts"
];

const typeCheckedConfigs = [
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked
].map((config) => ({ ...config, files: typescriptWorkspaceFiles }));


export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/coverage/**"] },
  eslint.configs.recommended,
  ...typeCheckedConfigs,
  {
    files: typescriptWorkspaceFiles,
    languageOptions: {
      parserOptions: { project: "./tsconfig.base.json", tsconfigRootDir: import.meta.dirname }
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-import-type-side-effects": "error"
    }
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: globals.node },
    rules: { "no-console": "off" }
  }
);
